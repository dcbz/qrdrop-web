# QRA1 protocol

The sender first displays one stationary setup QR. After the receiver recognizes it and tells the user to press Enter, the sender automatically cycles through timed data QR frames. Data packets may arrive in any order and may be repeated.

Setup packet:

```json
{"v":1,"k":"setup","id":"9fb2d1c4a6e8","n":"photo.jpg","s":145203,"t":224,"f":"transfer sha256 hex","ms":333}
```

Compressed setup packet, used when compression makes the transfer smaller:

```json
{"v":1,"k":"setup","id":"9fb2d1c4a6e8","n":"photo.jpg","s":42103,"t":65,"f":"compressed sha256 hex","ms":333,"c":"gzip","us":145203,"uf":"original sha256 hex"}
```

Data packet:

```json
{"v":1,"k":"data","id":"9fb2d1c4a6e8","n":"photo.jpg","s":145203,"i":4,"t":224,"d":"base64...","h":"chunk sha256 hex","f":"file sha256 hex"}
```

| Field | Meaning |
|---|---|
| `v` | Protocol version; must be `1` |
| `k` | Packet kind: `setup` or `data` |
| `id` | Random transfer identifier |
| `n` | UTF-8 file name without path components |
| `s` | Transfer payload size in bytes. For uncompressed transfers this is the original file size; for compressed transfers this is the compressed size. |
| `i` | Zero-based chunk index |
| `t` | Total chunk count |
| `d` | Standard padded Base64 of raw chunk bytes |
| `h` | Lowercase SHA-256 hex of raw chunk bytes |
| `f` | Lowercase SHA-256 hex of the complete transfer payload |
| `ms` | Setup packet only: milliseconds between data frames |
| `c` | Setup packet only, optional compression method. Currently `gzip`. |
| `us` | Setup packet only, uncompressed/original file size when `c` is present. |
| `uf` | Setup packet only, lowercase SHA-256 hex of the uncompressed/original file when `c` is present. |

The receiver creates a session only from a valid setup packet. All data packets repeat the immutable metadata. A receiver must reject a packet when `id`, `n`, `s`, `t`, or `f` differs from the active session. Duplicate indexes with identical data are ignored. Conflicting duplicates are invalid.

After receiving indexes `0..t-1`, concatenate decoded chunks in index order. The transfer payload is accepted only when its byte length equals `s` and its SHA-256 equals `f`. If `c` is present, decompress the accepted transfer payload and then verify the original byte length equals `us` and the original SHA-256 equals `uf`.
