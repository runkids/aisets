package scanner

func notifyProgress(progress ProgressFunc, event ScanProgress) {
	if progress != nil {
		progress(event)
	}
}
