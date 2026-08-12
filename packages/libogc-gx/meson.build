libogc_gx_auth_record_sources = files('src/auth_record.c')

libogc_gx_auth_record_includes = include_directories('src')

libogc_gx_auth_record_library = static_library(
  'multiplex-auth-record',
  libogc_gx_auth_record_sources,
  include_directories: libogc_gx_auth_record_includes,
)

multiplex_auth_record_dependency = declare_dependency(
  include_directories: libogc_gx_auth_record_includes,
  link_with: libogc_gx_auth_record_library,
)

libogc_gx_auth_record_test = executable(
  'libogc-gx-auth-record-test',
  files('../../apps/gamecube/tests/auth_record_test.c'),
  dependencies: multiplex_auth_record_dependency,
)

test(
  'libogc-gx-auth-record',
  libogc_gx_auth_record_test,
  suite: 'gamecube-portable',
)
