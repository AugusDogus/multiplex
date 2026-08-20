console_core_sources = files(
  'src/auth_record.c',
  'src/hls_playlist.c',
  'src/http_response.c',
  'src/mpeg_ts_parser.c',
)

console_core_includes = include_directories('include')

console_core_library = static_library(
  'multiplex-console-core',
  console_core_sources,
  include_directories: console_core_includes,
)

multiplex_console_core_dependency = declare_dependency(
  include_directories: console_core_includes,
  link_with: console_core_library,
)

console_core_tests = {
  'auth-record': '../../apps/gamecube/tests/auth_record_test.c',
  'hls-playlist': '../../apps/gamecube/tests/hls_playlist_test.c',
  'http-response': '../../apps/gamecube/tests/http_response_test.c',
  'mpeg-ts-parser': '../../apps/gamecube/tests/mpeg_ts_parser_test.c',
}

foreach test_name, test_source : console_core_tests
  test_executable = executable(
    'console-core-' + test_name + '-test',
    files(test_source),
    dependencies: multiplex_console_core_dependency,
  )
  test(
    'console-core-' + test_name,
    test_executable,
    suite: 'gamecube-portable',
  )
endforeach

xbox_storage_test = executable(
  'xbox-storage-test',
  '../../apps/xbox/storage.c',
  '../../apps/xbox/tests/storage_test.c',
  include_directories: [
    console_core_includes,
    include_directories('../../apps/xbox'),
  ],
  link_with: console_core_library,
  c_args: ['-D_GNU_SOURCE'],
)
test('xbox-storage', xbox_storage_test, suite: 'xbox-portable')

xbox_gateway_auth_test = executable(
  'xbox-gateway-auth-test',
  '../../apps/xbox/gateway_auth.c',
  '../../apps/xbox/tests/gateway_auth_test.c',
  include_directories: [
    console_core_includes,
    include_directories('../../apps/xbox'),
  ],
)
test('xbox-gateway-auth', xbox_gateway_auth_test, suite: 'xbox-portable')

xbox_gateway_catalog_test = executable(
  'xbox-gateway-catalog-test',
  '../../apps/xbox/gateway_catalog.c',
  '../../apps/xbox/tests/gateway_catalog_test.c',
  include_directories: include_directories('../../apps/xbox'),
)
test('xbox-gateway-catalog', xbox_gateway_catalog_test, suite: 'xbox-portable')
