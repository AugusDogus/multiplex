project(
  'multiplex-native',
  'c',
  version: '0.1.0',
  meson_version: '>=1.11.2',
  default_options: [
    'c_std=c11',
    'warning_level=3',
    'werror=true',
  ],
)

# Client-specific targets live in their app directory. Portable libraries expose
# declare_dependency() values there so future native clients can reuse them.
subdir('apps/gamecube')
