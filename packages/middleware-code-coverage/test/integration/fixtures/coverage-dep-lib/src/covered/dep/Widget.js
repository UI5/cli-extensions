sap.ui.define([], function() {
	"use strict";
	return {
		label(text) {
			if (text) {
				return "[" + text + "]";
			}
			return "[]";
		}
	};
});
