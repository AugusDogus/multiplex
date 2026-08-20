#pragma once

#include <napi.h>
#include <mpv/client.h>
#include <mpv/render.h>

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "video_surface.h"

struct NativePlayerEvent {
  enum class Type {
    kFileLoaded,
    kPlaybackChanged,
    kTimeChanged,
    kBufferingChanged,
    kSeeked,
    kEnded,
    kError,
  };

  Type type;
  double first_number = 0;
  double second_number = 0;
  bool flag = false;
  std::string message;
  std::int64_t source_generation = -1;
};

struct NativeLoadOptions {
  std::int64_t source_generation;
  std::string url;
  std::string title;
  double start_seconds;
  double volume;
  bool muted;
  double playback_rate;
};

struct NativeSurfacePresentation {
  bool visible;
  std::vector<std::uint8_t> owner_handle;
  SurfaceBounds bounds;
};

class LibmpvPlayer {
 public:
  LibmpvPlayer(Napi::Env env, Napi::Function callback);
  ~LibmpvPlayer();

  LibmpvPlayer(const LibmpvPlayer&) = delete;
  LibmpvPlayer& operator=(const LibmpvPlayer&) = delete;

  bool IsReady() const;
  const std::string& InitializationError() const;

  void Load(const NativeLoadOptions& options);
  void Play();
  void Pause();
  void Seek(double seconds);
  void SetVolume(double volume, bool muted);
  void SetRate(double playback_rate);
  void Present(NativeSurfacePresentation presentation);
  void Stop();
  void Dispose();

 private:
  static void Wakeup(void* context);
  static void RenderUpdate(void* context);
  static void* ResolveOpenGl(void* context, const char* name);

  void Run();
  void HandleEvent(mpv_event* event);
  void HandleProperty(std::uint64_t property_id, mpv_event_property* property);
  void ApplyPresentation();
  void RenderFrame();
  bool EnsureRenderContext();
  void Emit(NativePlayerEvent event);
  void EmitError(std::string message);
  void LoadCommand(const NativeLoadOptions& options);
  void Command(const std::vector<std::string>& arguments);

  mpv_handle* mpv_ = nullptr;
  mpv_render_context* render_context_ = nullptr;
  Napi::ThreadSafeFunction event_callback_;
  std::thread event_thread_;
  std::atomic<bool> disposed_ = false;
  std::atomic<bool> wake_requested_ = false;
  std::atomic<bool> render_requested_ = false;
  std::mutex wake_mutex_;
  std::condition_variable wake_condition_;

  std::mutex presentation_mutex_;
  std::optional<NativeSurfacePresentation> pending_presentation_;
  std::unique_ptr<VideoSurface> surface_;
  std::vector<std::uint8_t> surface_owner_handle_;

  double current_time_seconds_ = 0;
  double cache_seconds_ = 0;
  bool seeking_ = false;
  std::atomic<std::int64_t> pending_generation_ = -1;
  std::atomic<std::int64_t> active_generation_ = -1;
  std::string initialization_error_;
};
