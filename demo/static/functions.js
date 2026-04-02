function prettyFormatSpec(rawSpec) {
    let indentLevel = 0;
    const indentString = '  ';
    let result = '';
    let inString = false;
    let stringChar = '';
    let prevChar = '';

    for (let i = 0; i < rawSpec.length; i++) {
        const char = rawSpec[i];

        if (inString) {
            result += char;
            if (char === stringChar && prevChar !== '\\') {
                inString = false; // end of string
            }
        } else {
            if (char === '"' || char === "'") {
                inString = true;
                stringChar = char;
                result += char;
            } else if (char === '{' || char === '[') {
                indentLevel++;
                result += char + '\n' + indentString.repeat(indentLevel);
            } else if (char === '}' || char === ']') {
                indentLevel--;
                result += '\n' + indentString.repeat(indentLevel) + char;
            } else if (char === ',') {
                result += char + '\n' + indentString.repeat(indentLevel);
            } else if (char === ':') {
                result += ': ';
            } else {
                result += char;
            }
        }

        prevChar = char;
    }

    return result;
}