#!/bin/sh
set -eu

destination=$1
ca_file=${GAMECUBE_TLS_CA_FILE:-}
if [ -z "$ca_file" ] && [ -n "${HOME:-}" ]; then
  case ${MULTIPLEX_BASE_URL:-} in
    https://*.localhost | https://*.localhost/*)
      portless_ca_file="$HOME/.portless/ca.pem"
      if [ -s "$portless_ca_file" ]; then
        ca_file=$portless_ca_file
      fi
      ;;
  esac
fi

{
  echo "#ifndef MULTIPLEX_TLS_CA_H"
  echo "#define MULTIPLEX_TLS_CA_H"
  echo
  if [ -n "$ca_file" ] && [ -s "$ca_file" ]; then
    echo "static const char multiplex_tls_ca_pem[] ="
    sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
      -e 's/^/"/' -e 's/$/\\n"/' "$ca_file"
    echo ";"
    echo "static const unsigned multiplex_tls_ca_pem_size ="
    echo "    sizeof(multiplex_tls_ca_pem);"
  else
    echo "static const char multiplex_tls_ca_pem[] = \"\";"
    echo "static const unsigned multiplex_tls_ca_pem_size = 0;"
  fi
  echo
  echo "#endif"
} >"$destination"
