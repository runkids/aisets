package apierr

type Error struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Params  map[string]any `json:"params,omitempty"`
}

func New(code, message string) Error {
	return Error{Code: code, Message: message}
}

func WithParams(code, message string, params map[string]any) Error {
	return Error{Code: code, Message: message, Params: params}
}

func (e Error) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return e.Code
}

func From(err error, fallbackCode string) Error {
	if err == nil {
		return New(fallbackCode, "")
	}
	if coded, ok := err.(Error); ok {
		return coded
	}
	if fallbackCode == "" {
		fallbackCode = "internal_error"
	}
	return New(fallbackCode, err.Error())
}
