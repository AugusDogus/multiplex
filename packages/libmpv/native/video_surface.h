#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

struct SurfaceBounds {
  double x;
  double y;
  double width;
  double height;
  double device_scale_factor;
};

class VideoSurface {
 public:
  virtual ~VideoSurface() = default;

  VideoSurface(const VideoSurface&) = delete;
  VideoSurface& operator=(const VideoSurface&) = delete;

  virtual bool Show(const SurfaceBounds& bounds, std::string* error) = 0;
  virtual void Hide() = 0;
  virtual bool MakeCurrent(std::string* error) = 0;
  virtual void SwapBuffers() = 0;
  virtual void* GetProcAddress(const char* name) = 0;
  virtual int PixelWidth() const = 0;
  virtual int PixelHeight() const = 0;

  static std::unique_ptr<VideoSurface> Create(
      const std::vector<std::uint8_t>& owner_handle,
      std::string* error);

 protected:
  VideoSurface() = default;
};
