//go:build embed_imgtools

package imgtools

import _ "embed"

//go:embed bin/aisets-imgtools
var embeddedBinary []byte
