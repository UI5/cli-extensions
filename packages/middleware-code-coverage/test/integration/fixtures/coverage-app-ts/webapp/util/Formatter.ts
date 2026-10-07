/*!
 * ${copyright}
 */
export default class Formatter {
	format(value: string): string {
		if (value) {
			return value.toUpperCase();
		}
		return "";
	}
}
