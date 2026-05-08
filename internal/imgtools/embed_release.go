//go:build embed_imgtools

package imgtools

import _ "embed"

//go:embed bin/asset-studio-imgtools
var embeddedBinary []byte
