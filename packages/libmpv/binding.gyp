{
  "variables": {
    "mpv_sdk_root%": "<(module_root_dir)/vendor/mpv"
  },
  "targets": [
    {
      "target_name": "multiplex_libmpv",
      "sources": [
        "native/addon.cc",
        "native/libmpv_player.cc",
        "native/video_surface.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "<(mpv_sdk_root)/include"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "cflags_cc": ["-std=c++20"],
      "conditions": [
        ["OS=='linux'", {
          "libraries": [
            "-L<(mpv_sdk_root)/lib",
            "-lmpv",
            "-lGL",
            "-lX11"
          ]
        }],
        ["OS=='win'", {
          "libraries": [
            "<(mpv_sdk_root)/lib/mpv.lib",
            "opengl32.lib",
            "user32.lib",
            "gdi32.lib"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": ["/std:c++20"]
            }
          }
        }],
        ["OS=='mac'", {
          "sources": ["native/video_surface_mac.mm"],
          "sources!": ["native/video_surface.cc"],
          "libraries": [
            "-L<(mpv_sdk_root)/lib",
            "-lmpv",
            "-framework Cocoa",
            "-framework OpenGL"
          ],
          "xcode_settings": {
            "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
            "MACOSX_DEPLOYMENT_TARGET": "13.0"
          }
        }]
      ]
    }
  ]
}
