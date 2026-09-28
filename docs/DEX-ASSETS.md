# PEX proof assets

Pinned from the official PLabs distribution. Existing transfer/shield proving remains unchanged.

- Worker: https://app.plabs.online/assets/groth16Prover.worker-BEe_5aQ4.js
- Manifest: https://app.plabs.online/wasm/asset-manifest.json
- Version: aaeba55a93a41b4221ffd0f7b6f41c83e077c331da9deb945e18e006373c6a78
- The new hashed JS module also has a root `/wasm/<version>/` alias because the official worker dynamically imports that manifest path. DEX fetches resolve to `/dex/wasm/`; the existing wallet manifest remains unchanged.
- Module and WASM bytes verified against manifest SHA-256; action/binding artifacts match existing bundled hashes.
- Release packaging validates every pinned file in scripts/vendor-assets.lock.json.

Byte integrity is not an independent cryptographic audit.
