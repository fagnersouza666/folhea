// Build Caddy as a dependency so the stable release remains in build metadata.
// Only upstream standard modules are registered; no third-party plugins.
package main

import (
	caddycmd "github.com/caddyserver/caddy/v2/cmd"
	_ "github.com/caddyserver/caddy/v2/modules/standard"
)

func main() {
	caddycmd.Main()
}
