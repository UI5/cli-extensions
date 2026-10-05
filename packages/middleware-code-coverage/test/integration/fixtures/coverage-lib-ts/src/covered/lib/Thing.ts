/*!
 * ${copyright}
 */
export default class Thing {
	greet(name: string): string {
		if (name) {
			return "Hello " + name;
		}
		return "Hello world";
	}
}
