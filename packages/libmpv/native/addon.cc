#include <napi.h>

#include <cmath>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "libmpv_player.h"

namespace {

bool RequireArgumentCount(const Napi::CallbackInfo& info, std::size_t count,
                          const char* method) {
  if (info.Length() >= count) return true;
  Napi::TypeError::New(info.Env(), std::string(method) + " received too few arguments.")
      .ThrowAsJavaScriptException();
  return false;
}

bool ReadFiniteNumber(const Napi::Value& value, const char* field,
                      double* output) {
  if (!value.IsNumber()) {
    Napi::TypeError::New(value.Env(), std::string(field) + " must be a number.")
        .ThrowAsJavaScriptException();
    return false;
  }
  const double number = value.As<Napi::Number>().DoubleValue();
  if (!std::isfinite(number)) {
    Napi::RangeError::New(value.Env(), std::string(field) + " must be finite.")
        .ThrowAsJavaScriptException();
    return false;
  }
  *output = number;
  return true;
}

bool ReadString(const Napi::Value& value, const char* field,
                std::string* output) {
  if (!value.IsString()) {
    Napi::TypeError::New(value.Env(), std::string(field) + " must be a string.")
        .ThrowAsJavaScriptException();
    return false;
  }
  *output = value.As<Napi::String>().Utf8Value();
  return true;
}

bool ReadBoolean(const Napi::Value& value, const char* field, bool* output) {
  if (!value.IsBoolean()) {
    Napi::TypeError::New(value.Env(), std::string(field) + " must be a boolean.")
        .ThrowAsJavaScriptException();
    return false;
  }
  *output = value.As<Napi::Boolean>().Value();
  return true;
}

class NativePlayerWrap final : public Napi::ObjectWrap<NativePlayerWrap> {
 public:
  static Napi::Function Initialize(Napi::Env env) {
    return DefineClass(
        env, "MultiplexLibmpvPlayer",
        {
            InstanceMethod("load", &NativePlayerWrap::Load),
            InstanceMethod("play", &NativePlayerWrap::Play),
            InstanceMethod("pause", &NativePlayerWrap::Pause),
            InstanceMethod("seek", &NativePlayerWrap::Seek),
            InstanceMethod("setVolume", &NativePlayerWrap::SetVolume),
            InstanceMethod("setRate", &NativePlayerWrap::SetRate),
            InstanceMethod("present", &NativePlayerWrap::Present),
            InstanceMethod("stop", &NativePlayerWrap::Stop),
            InstanceMethod("dispose", &NativePlayerWrap::Dispose),
        });
  }

  explicit NativePlayerWrap(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<NativePlayerWrap>(info) {
    if (!RequireArgumentCount(info, 1, "createPlayer") ||
        !info[0].IsFunction()) {
      if (info.Length() >= 1 && !info[0].IsFunction()) {
        Napi::TypeError::New(info.Env(), "createPlayer requires an event callback.")
            .ThrowAsJavaScriptException();
      }
      return;
    }
    player_ = std::make_unique<LibmpvPlayer>(
        info.Env(), info[0].As<Napi::Function>());
    if (!player_->IsReady()) {
      const std::string message = player_->InitializationError();
      player_.reset();
      Napi::Error::New(info.Env(), message).ThrowAsJavaScriptException();
    }
  }

 private:
  Napi::Value Load(const Napi::CallbackInfo& info) {
    if (!RequirePlayer(info) || !RequireArgumentCount(info, 1, "load") ||
        !info[0].IsObject()) {
      if (info.Length() >= 1 && !info[0].IsObject()) {
        Napi::TypeError::New(info.Env(), "load requires an options object.")
            .ThrowAsJavaScriptException();
      }
      return info.Env().Undefined();
    }
    const Napi::Object input = info[0].As<Napi::Object>();
    NativeLoadOptions options;
    double source_generation = 0;
    if (!ReadFiniteNumber(input.Get("sourceGeneration"), "sourceGeneration",
                          &source_generation) ||
        !ReadString(input.Get("url"), "url", &options.url) ||
        !ReadString(input.Get("title"), "title", &options.title) ||
        !ReadFiniteNumber(input.Get("startSeconds"), "startSeconds",
                          &options.start_seconds) ||
        !ReadFiniteNumber(input.Get("volume"), "volume", &options.volume) ||
        !ReadBoolean(input.Get("muted"), "muted", &options.muted) ||
        !ReadFiniteNumber(input.Get("playbackRate"), "playbackRate",
                          &options.playback_rate)) {
      return info.Env().Undefined();
    }
    options.source_generation = static_cast<std::int64_t>(source_generation);
    player_->Load(options);
    return info.Env().Undefined();
  }

  Napi::Value Play(const Napi::CallbackInfo& info) {
    if (RequirePlayer(info)) player_->Play();
    return info.Env().Undefined();
  }

  Napi::Value Pause(const Napi::CallbackInfo& info) {
    if (RequirePlayer(info)) player_->Pause();
    return info.Env().Undefined();
  }

  Napi::Value Seek(const Napi::CallbackInfo& info) {
    double seconds = 0;
    if (RequirePlayer(info) && RequireArgumentCount(info, 1, "seek") &&
        ReadFiniteNumber(info[0], "seconds", &seconds)) {
      player_->Seek(seconds);
    }
    return info.Env().Undefined();
  }

  Napi::Value SetVolume(const Napi::CallbackInfo& info) {
    double volume = 0;
    bool muted = false;
    if (RequirePlayer(info) && RequireArgumentCount(info, 2, "setVolume") &&
        ReadFiniteNumber(info[0], "volume", &volume) &&
        ReadBoolean(info[1], "muted", &muted)) {
      player_->SetVolume(volume, muted);
    }
    return info.Env().Undefined();
  }

  Napi::Value SetRate(const Napi::CallbackInfo& info) {
    double rate = 0;
    if (RequirePlayer(info) && RequireArgumentCount(info, 1, "setRate") &&
        ReadFiniteNumber(info[0], "playbackRate", &rate)) {
      player_->SetRate(rate);
    }
    return info.Env().Undefined();
  }

  Napi::Value Present(const Napi::CallbackInfo& info) {
    if (!RequirePlayer(info) || !RequireArgumentCount(info, 1, "present") ||
        !info[0].IsObject()) {
      if (info.Length() >= 1 && !info[0].IsObject()) {
        Napi::TypeError::New(info.Env(), "present requires a surface object.")
            .ThrowAsJavaScriptException();
      }
      return info.Env().Undefined();
    }
    const Napi::Object input = info[0].As<Napi::Object>();
    std::string tag;
    if (!ReadString(input.Get("_tag"), "_tag", &tag)) {
      return info.Env().Undefined();
    }
    if (tag == "Hidden") {
      player_->Present({.visible = false});
      return info.Env().Undefined();
    }
    if (tag != "Visible") {
      Napi::TypeError::New(info.Env(), "surface _tag must be Hidden or Visible.")
          .ThrowAsJavaScriptException();
      return info.Env().Undefined();
    }
    const Napi::Value handle = input.Get("ownerHandle");
    if (!handle.IsBuffer()) {
      Napi::TypeError::New(info.Env(), "ownerHandle must be a Buffer.")
          .ThrowAsJavaScriptException();
      return info.Env().Undefined();
    }
    const Napi::Buffer<std::uint8_t> bytes = handle.As<Napi::Buffer<std::uint8_t>>();
    NativeSurfacePresentation presentation{
        .visible = true,
        .owner_handle = std::vector<std::uint8_t>(bytes.Data(),
                                                  bytes.Data() + bytes.Length()),
    };
    if (!ReadFiniteNumber(input.Get("x"), "x", &presentation.bounds.x) ||
        !ReadFiniteNumber(input.Get("y"), "y", &presentation.bounds.y) ||
        !ReadFiniteNumber(input.Get("width"), "width",
                          &presentation.bounds.width) ||
        !ReadFiniteNumber(input.Get("height"), "height",
                          &presentation.bounds.height) ||
        !ReadFiniteNumber(input.Get("deviceScaleFactor"), "deviceScaleFactor",
                          &presentation.bounds.device_scale_factor)) {
      return info.Env().Undefined();
    }
    player_->Present(std::move(presentation));
    return info.Env().Undefined();
  }

  Napi::Value Stop(const Napi::CallbackInfo& info) {
    if (RequirePlayer(info)) player_->Stop();
    return info.Env().Undefined();
  }

  Napi::Value Dispose(const Napi::CallbackInfo& info) {
    if (player_) {
      player_->Dispose();
      player_.reset();
    }
    return info.Env().Undefined();
  }

  bool RequirePlayer(const Napi::CallbackInfo& info) {
    if (player_) return true;
    Napi::Error::New(info.Env(), "The libmpv player has already been disposed.")
        .ThrowAsJavaScriptException();
    return false;
  }

  std::unique_ptr<LibmpvPlayer> player_;
};

Napi::Object InitializeAddon(Napi::Env env, Napi::Object exports) {
  const Napi::Function player_class = NativePlayerWrap::Initialize(env);
  exports.Set(
      "createPlayer",
      Napi::Function::New(
          env,
          [player_class](const Napi::CallbackInfo& info) -> Napi::Value {
            if (!RequireArgumentCount(info, 1, "createPlayer")) {
              return info.Env().Undefined();
            }
            return player_class.New({info[0]});
          },
          "createPlayer"));
  return exports;
}

}  // namespace

NODE_API_MODULE(multiplex_libmpv, InitializeAddon)
