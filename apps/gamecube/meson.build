gamecube_auth_record_sources = files(
  'host-reference-gx/auth_record.c',
)

gamecube_auth_record_includes = include_directories(
  'host-reference-gx',
)

gamecube_auth_record_library = static_library(
  'multiplex-auth-record',
  gamecube_auth_record_sources,
  include_directories: gamecube_auth_record_includes,
)

# This dependency is the first reusable portable native boundary. Future client
# subdirectories can link it without duplicating source lists or compiler flags.
multiplex_auth_record_dependency = declare_dependency(
  include_directories: gamecube_auth_record_includes,
  link_with: gamecube_auth_record_library,
)

gamecube_auth_record_test = executable(
  'gamecube-auth-record-test',
  files('tests/auth_record_test.c'),
  dependencies: multiplex_auth_record_dependency,
)

test(
  'gamecube-auth-record',
  gamecube_auth_record_test,
  suite: 'gamecube-portable',
)
