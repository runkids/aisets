package config

import (
	"database/sql/driver"
	"regexp"
	"strings"

	"modernc.org/sqlite"
)

func init() {
	sqlite.MustRegisterDeterministicScalarFunction("asset_folder", 1, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		if len(args) != 1 {
			return "", nil
		}
		value, _ := args[0].(string)
		index := strings.LastIndex(value, "/")
		if index <= 0 {
			return "", nil
		}
		return value[:index], nil
	})
	sqlite.MustRegisterDeterministicScalarFunction("asset_name", 1, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		if len(args) != 1 {
			return "", nil
		}
		value, _ := args[0].(string)
		index := strings.LastIndex(value, "/")
		if index < 0 || index == len(value)-1 {
			return value, nil
		}
		return value[index+1:], nil
	})
	sqlite.MustRegisterDeterministicScalarFunction("regexp_like", 2, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		if len(args) != 2 {
			return int64(0), nil
		}
		value, _ := args[0].(string)
		pattern, _ := args[1].(string)
		matched, err := regexp.MatchString(pattern, value)
		if err != nil || !matched {
			return int64(0), nil
		}
		return int64(1), nil
	})
}
