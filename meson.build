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

# Shared native runtime targets live with the package that owns their sources.
subdir('packages/libogc-gx')
