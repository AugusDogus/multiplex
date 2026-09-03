#include "libmpv_player.h"

#include <mpv/render_gl.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <utility>

namespace {

constexpr std::uint64_t kCommandRequestId = 1;
constexpr int kDurationProperty = 1;
constexpr int kPauseProperty = 2;
constexpr int kTimeProperty = 3;
constexpr int kCacheProperty = 4;
constexpr int kBufferingProperty = 5;
constexpr int kSeekingProperty = 6;

double FiniteNonNegative(double value) {
  return std::isfinite(value) ? std::max(0.0, value) : 0.0;
}

void SetOption(mpv_handle* handle, const char* name, const char* value) {
  mpv_set_option_string(handle, name, value);
}

Napi::Object EventToJs(Napi::Env env, const NativePlayerEvent& event) {
  Napi::Object output = Napi::Object::New(env);
  output.Set("sourceGeneration", Napi::Number::New(
                                     env, static_cast<double>(event.source_generation)));
  switch (event.type) {
    case NativePlayerEvent::Type::kFileLoaded:
      output.Set("_tag", "FileLoaded");
      output.Set("durationSeconds", event.first_number);
      break;
    case NativePlayerEvent::Type::kPlaybackChanged:
      output.Set("_tag", "PlaybackChanged");
      output.Set("isPlaying", event.flag);
      break;
    case NativePlayerEvent::Type::kTimeChanged:
      output.Set("_tag", "TimeChanged");
      output.Set("currentTimeSeconds", event.first_number);
      output.Set("bufferedTimeSeconds", event.second_number);
      break;
    case NativePlayerEvent::Type::kBufferingChanged:
      output.Set("_tag", "BufferingChanged");
      output.Set("isBuffering", event.flag);
      break;
    case NativePlayerEvent::Type::kSeeked:
      output.Set("_tag", "Seeked");
      output.Set("currentTimeSeconds", event.first_number);
      break;
    case NativePlayerEvent::Type::kEnded:
      output.Set("_tag", "Ended");
      break;
    case NativePlayerEvent::Type::kError:
      output.Set("_tag", "Error");
      output.Set("message", event.message);
      break;
  }
  return output;
}

}  // namespace

LibmpvPlayer::LibmpvPlayer(Napi::Env env, Napi::Function callback)
    : event_callback_(Napi::ThreadSafeFunction::New(
          env, callback, "Multiplex libmpv events", 0, 1)) {
  mpv_ = mpv_create();
  if (mpv_ == nullptr) {
    initialization_error_ = "libmpv could not allocate a player instance.";
    return;
  }

  SetOption(mpv_, "config", "no");
  SetOption(mpv_, "vo", "libmpv");
  SetOption(mpv_, "hwdec", "auto-safe");
  SetOption(mpv_, "terminal", "no");
  SetOption(mpv_, "input-default-bindings", "no");
  SetOption(mpv_, "osc", "no");
  SetOption(mpv_, "keep-open", "no");

  const int initialize_result = mpv_initialize(mpv_);
  if (initialize_result < 0) {
    initialization_error_ = std::string("libmpv initialization failed: ") +
                            mpv_error_string(initialize_result);
    mpv_terminate_destroy(mpv_);
    mpv_ = nullptr;
    return;
  }

  mpv_observe_property(mpv_, kDurationProperty, "duration", MPV_FORMAT_DOUBLE);
  mpv_observe_property(mpv_, kPauseProperty, "pause", MPV_FORMAT_FLAG);
  mpv_observe_property(mpv_, kTimeProperty, "time-pos", MPV_FORMAT_DOUBLE);
  mpv_observe_property(mpv_, kCacheProperty, "demuxer-cache-duration",
                       MPV_FORMAT_DOUBLE);
  mpv_observe_property(mpv_, kBufferingProperty, "paused-for-cache",
                       MPV_FORMAT_FLAG);
  mpv_observe_property(mpv_, kSeekingProperty, "seeking", MPV_FORMAT_FLAG);
  mpv_set_wakeup_callback(mpv_, &LibmpvPlayer::Wakeup, this);

  event_thread_ = std::thread(&LibmpvPlayer::Run, this);
}

LibmpvPlayer::~LibmpvPlayer() { Dispose(); }

bool LibmpvPlayer::IsReady() const { return mpv_ != nullptr; }

const std::string& LibmpvPlayer::InitializationError() const {
  return initialization_error_;
}

void LibmpvPlayer::Load(const NativeLoadOptions& options) {
  if (!IsReady()) return;
  active_generation_ = -1;
  pending_generation_ = options.source_generation;
  SetVolume(options.volume, options.muted);
  SetRate(options.playback_rate);
  LoadCommand(options);
}

void LibmpvPlayer::Play() { Command({"set", "pause", "no"}); }

void LibmpvPlayer::Pause() { Command({"set", "pause", "yes"}); }

void LibmpvPlayer::Seek(double seconds) {
  Command({"seek", std::to_string(FiniteNonNegative(seconds)),
           "absolute+exact"});
}

void LibmpvPlayer::SetVolume(double volume, bool muted) {
  Command({"set", "volume", std::to_string(std::clamp(volume, 0.0, 1.0) * 100)});
  Command({"set", "mute", muted ? "yes" : "no"});
}

void LibmpvPlayer::SetRate(double playback_rate) {
  const double safe_rate =
      std::isfinite(playback_rate) ? std::clamp(playback_rate, 0.01, 100.0) : 1.0;
  Command({"set", "speed", std::to_string(safe_rate)});
}

void LibmpvPlayer::Present(NativeSurfacePresentation presentation) {
  {
    std::lock_guard lock(presentation_mutex_);
    pending_presentation_ = std::move(presentation);
  }
  wake_requested_ = true;
  wake_condition_.notify_one();
}

void LibmpvPlayer::Stop() { Command({"stop"}); }

void LibmpvPlayer::Dispose() {
  if (disposed_.exchange(true)) return;
  wake_condition_.notify_one();
  if (event_thread_.joinable()) event_thread_.join();
  if (render_context_ != nullptr) {
    mpv_render_context_free(render_context_);
    render_context_ = nullptr;
  }
  surface_.reset();
  if (mpv_ != nullptr) {
    mpv_set_wakeup_callback(mpv_, nullptr, nullptr);
    mpv_terminate_destroy(mpv_);
    mpv_ = nullptr;
  }
  event_callback_.Release();
}

void LibmpvPlayer::Wakeup(void* context) {
  auto* player = static_cast<LibmpvPlayer*>(context);
  player->wake_requested_ = true;
  player->wake_condition_.notify_one();
}

void LibmpvPlayer::RenderUpdate(void* context) {
  auto* player = static_cast<LibmpvPlayer*>(context);
  player->render_requested_ = true;
  player->wake_condition_.notify_one();
}

void* LibmpvPlayer::ResolveOpenGl(void* context, const char* name) {
  return static_cast<VideoSurface*>(context)->GetProcAddress(name);
}

void LibmpvPlayer::Run() {
  while (!disposed_) {
    ApplyPresentation();

    if (mpv_ != nullptr) {
      for (;;) {
        mpv_event* event = mpv_wait_event(mpv_, 0);
        if (event->event_id == MPV_EVENT_NONE) break;
        HandleEvent(event);
      }
    }

    if (render_requested_.exchange(false)) RenderFrame();

    std::unique_lock lock(wake_mutex_);
    wake_condition_.wait_for(lock, std::chrono::milliseconds(16), [this] {
      return disposed_ || wake_requested_.exchange(false) ||
             render_requested_.load();
    });
  }
}

void LibmpvPlayer::HandleEvent(mpv_event* event) {
  switch (event->event_id) {
    case MPV_EVENT_FILE_LOADED: {
      active_generation_ = pending_generation_.load();
      double duration = 0;
      mpv_get_property(mpv_, "duration", MPV_FORMAT_DOUBLE, &duration);
      Emit({.type = NativePlayerEvent::Type::kFileLoaded,
            .first_number = FiniteNonNegative(duration),
            .source_generation = active_generation_.load()});
      break;
    }
    case MPV_EVENT_PROPERTY_CHANGE:
      HandleProperty(event->reply_userdata,
                     static_cast<mpv_event_property*>(event->data));
      break;
    case MPV_EVENT_END_FILE: {
      const auto* end = static_cast<mpv_event_end_file*>(event->data);
      if (end->reason == MPV_END_FILE_REASON_EOF) {
        Emit({.type = NativePlayerEvent::Type::kEnded,
              .source_generation = active_generation_.load()});
      } else if (end->reason == MPV_END_FILE_REASON_ERROR) {
        EmitError(std::string("libmpv playback failed: ") +
                  mpv_error_string(end->error));
      }
      break;
    }
    case MPV_EVENT_SHUTDOWN:
      disposed_ = true;
      break;
    default:
      break;
  }
}

void LibmpvPlayer::HandleProperty(std::uint64_t property_id,
                                  mpv_event_property* property) {
  if (property == nullptr || property->data == nullptr) return;
  const std::int64_t source_generation = active_generation_.load();
  if (source_generation < 0) return;

  switch (property_id) {
    case kPauseProperty: {
      const bool paused = *static_cast<int*>(property->data) != 0;
      Emit({.type = NativePlayerEvent::Type::kPlaybackChanged,
            .flag = !paused,
            .source_generation = source_generation});
      break;
    }
    case kTimeProperty:
      current_time_seconds_ =
          FiniteNonNegative(*static_cast<double*>(property->data));
      Emit({.type = NativePlayerEvent::Type::kTimeChanged,
            .first_number = current_time_seconds_,
            .second_number = current_time_seconds_ + cache_seconds_,
            .source_generation = source_generation});
      break;
    case kCacheProperty:
      cache_seconds_ = FiniteNonNegative(*static_cast<double*>(property->data));
      break;
    case kBufferingProperty: {
      const bool buffering = *static_cast<int*>(property->data) != 0;
      Emit({.type = NativePlayerEvent::Type::kBufferingChanged,
            .flag = buffering,
            .source_generation = source_generation});
      break;
    }
    case kSeekingProperty: {
      const bool now_seeking = *static_cast<int*>(property->data) != 0;
      if (seeking_ && !now_seeking) {
        Emit({.type = NativePlayerEvent::Type::kSeeked,
              .first_number = current_time_seconds_,
              .source_generation = source_generation});
      }
      seeking_ = now_seeking;
      break;
    }
    default:
      break;
  }
}

void LibmpvPlayer::ApplyPresentation() {
  std::optional<NativeSurfacePresentation> presentation;
  {
    std::lock_guard lock(presentation_mutex_);
    presentation.swap(pending_presentation_);
  }
  if (!presentation) return;

  if (!presentation->visible) {
    if (surface_) surface_->Hide();
    return;
  }

  if (!surface_ || surface_owner_handle_ != presentation->owner_handle) {
    if (render_context_ != nullptr) {
      mpv_render_context_free(render_context_);
      render_context_ = nullptr;
    }
    surface_.reset();
    std::string error;
    surface_ = VideoSurface::Create(presentation->owner_handle, &error);
    if (!surface_) {
      EmitError(std::move(error));
      return;
    }
    surface_owner_handle_ = presentation->owner_handle;
  }

  std::string error;
  if (!surface_->Show(presentation->bounds, &error)) {
    EmitError(std::move(error));
    return;
  }
  if (!EnsureRenderContext()) return;
  render_requested_ = true;
}

bool LibmpvPlayer::EnsureRenderContext() {
  if (render_context_ != nullptr) return true;
  if (!surface_) return false;

  std::string error;
  if (!surface_->MakeCurrent(&error)) {
    EmitError(std::move(error));
    return false;
  }

  mpv_opengl_init_params open_gl{
      .get_proc_address = &LibmpvPlayer::ResolveOpenGl,
      .get_proc_address_ctx = surface_.get(),
  };
  mpv_render_param parameters[] = {
      {MPV_RENDER_PARAM_API_TYPE,
       const_cast<char*>(MPV_RENDER_API_TYPE_OPENGL)},
      {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &open_gl},
      {MPV_RENDER_PARAM_INVALID, nullptr},
  };
  const int result = mpv_render_context_create(&render_context_, mpv_, parameters);
  if (result < 0) {
    EmitError(std::string("libmpv could not create its OpenGL render context: ") +
              mpv_error_string(result));
    return false;
  }
  mpv_render_context_set_update_callback(render_context_,
                                         &LibmpvPlayer::RenderUpdate, this);
  return true;
}

void LibmpvPlayer::RenderFrame() {
  if (!surface_ || !EnsureRenderContext()) return;
  std::string error;
  if (!surface_->MakeCurrent(&error)) {
    EmitError(std::move(error));
    return;
  }

  mpv_opengl_fbo framebuffer{
      .fbo = 0,
      .w = surface_->PixelWidth(),
      .h = surface_->PixelHeight(),
      .internal_format = 0,
  };
  int flip_y = 1;
  mpv_render_param parameters[] = {
      {MPV_RENDER_PARAM_OPENGL_FBO, &framebuffer},
      {MPV_RENDER_PARAM_FLIP_Y, &flip_y},
      {MPV_RENDER_PARAM_INVALID, nullptr},
  };
  mpv_render_context_render(render_context_, parameters);
  surface_->SwapBuffers();
}

void LibmpvPlayer::Emit(NativePlayerEvent event) {
  auto* payload = new NativePlayerEvent(std::move(event));
  const napi_status result = event_callback_.NonBlockingCall(
      payload, [](Napi::Env env, Napi::Function callback,
                  NativePlayerEvent* delivered) {
        callback.Call({EventToJs(env, *delivered)});
        delete delivered;
      });
  if (result != napi_ok) delete payload;
}

void LibmpvPlayer::EmitError(std::string message) {
  Emit({.type = NativePlayerEvent::Type::kError,
        .message = std::move(message),
        .source_generation = active_generation_.load()});
}

void LibmpvPlayer::LoadCommand(const NativeLoadOptions& options) {
  if (!IsReady() || disposed_) return;

  std::string command_name = "loadfile";
  std::string url = options.url;
  std::string flags = "replace";
  std::string start_seconds = std::to_string(options.start_seconds);
  std::string title = options.title;
  char start_key[] = "start";
  char title_key[] = "force-media-title";
  char* option_keys[] = {start_key, title_key};
  mpv_node option_values[] = {
      {.u = {.string = start_seconds.data()}, .format = MPV_FORMAT_STRING},
      {.u = {.string = title.data()}, .format = MPV_FORMAT_STRING},
  };
  mpv_node_list option_list{
      .num = 2,
      .values = option_values,
      .keys = option_keys,
  };

  mpv_node command_values[] = {
      {.u = {.string = command_name.data()}, .format = MPV_FORMAT_STRING},
      {.u = {.string = url.data()}, .format = MPV_FORMAT_STRING},
      {.u = {.string = flags.data()}, .format = MPV_FORMAT_STRING},
      {.u = {.int64 = -1}, .format = MPV_FORMAT_INT64},
      {.u = {.list = &option_list}, .format = MPV_FORMAT_NODE_MAP},
  };
  mpv_node_list command_list{
      .num = 5,
      .values = command_values,
      .keys = nullptr,
  };
  mpv_node command{
      .u = {.list = &command_list},
      .format = MPV_FORMAT_NODE_ARRAY,
  };
  const int result = mpv_command_node_async(mpv_, kCommandRequestId, &command);
  if (result < 0) {
    EmitError(std::string("libmpv rejected the media load command: ") +
              mpv_error_string(result));
  }
}

void LibmpvPlayer::Command(const std::vector<std::string>& arguments) {
  if (!IsReady() || disposed_) return;
  std::vector<const char*> command;
  command.reserve(arguments.size() + 1);
  for (const std::string& argument : arguments) command.push_back(argument.c_str());
  command.push_back(nullptr);
  const int result = mpv_command_async(mpv_, kCommandRequestId, command.data());
  if (result < 0) {
    EmitError(std::string("libmpv rejected a playback command: ") +
              mpv_error_string(result));
  }
}
