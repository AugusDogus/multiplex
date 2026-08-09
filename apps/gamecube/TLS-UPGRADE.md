# Upgrade Mbed TLS

Use this guide when you change `MBEDTLS_COMMIT` in `PINS.env`. The current pin
is Mbed TLS 3.6.4 at commit
`c765c831e5c2a0971410692f92f7a81d6ec65ec2`.

## Review X.509 name matching

Mbed TLS uses semantic X.509 name matching when it selects a certificate
issuer. Raw `subject_raw` and `issuer_raw` equality is too strict. It rejects
permitted UTF8String and PrintableString differences, including ASCII case
differences.

`host-reference-gx/x509_name_compare.c` owns the matching copy used by the
bounded CA callback. It reads the public `oid`, `val`, and `next` fields. It
uses `mbedtls_x509_dn_get_next()` to detect relative distinguished name
boundaries. Do not replace the comparison with raw DER equality or private
`mbedtls_x509_name` fields.

When you update the pin:

1. Compare the new upstream X.509 name comparator with
   `multiplex_x509_name_equal()`.
2. Confirm that `mbedtls_x509_dn_get_next()` remains public and keeps its
   boundary semantics. If the API changes, adapt only
   `x509_name_compare.c` and its focused test.
3. Run `bun run gamecube:bootstrap` to rebuild the reduced PowerPC libraries
   and stage their public headers.
4. Run the deterministic and PowerPC gates:

   ```sh
   sh apps/gamecube/scripts/test-x509-name-compare.sh
   bun run gamecube:test:portable
   bun run gamecube:test:sanitize
   bun run gamecube:reference:dol
   ```

5. Run `bun run gamecube:reference:plex` against public Plex HTTPS and a
   Portless-backed local origin. Record the gate as unavailable when the Plex
   account, local CA, or network path is unavailable.

The CA callback still scans and parses one PEM certificate at a time. An Mbed
TLS upgrade must not replace that bounded scan with a parsed copy of the full
Mozilla bundle.
