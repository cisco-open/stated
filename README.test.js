const JeepCliCore = require('./src/JeepCliCore');
const fs = require('fs');
const {stringify} = require("./jeep");
test("test README", async () => {
    const markdownContent = fs.readFileSync("README.md", 'utf-8');
    /**
     * Regular expression for command extraction from README.md file. This program finds all the markup code blocks
     * that begin and and with ``` (markdown syntax for code block) and it extracts the jeep cli command and the
     * response. It then runs the cli command and compares the response to what is in the README.md. This ensures
     * that the README is always accurate.
     *
     * /^> \.(?<command>.+[\r\n])((?<expectedResponse>(?:(?!^>|```)[\s\S])*))$/gm
     *
     * Breakdown:
     *
     * ^: Start of a line (because we're using the 'm' flag which makes ^ and $ match start and end of lines respectively)
     *
     * > : Matches the ">" character literally. This assumes that your command lines in the README start with ">".
     *
     * \. : Matches the "." character literally.
     *
     * (?<command>.+[\r\n]): Named capturing group 'command'. Matches any number of characters (using .+), followed by a line break (using [\r\n]).
     *
     * ((?<expectedResponse>(?:(?!^>|```)[\s\S])*)): Named capturing group 'expectedResponse'. Matches any number of characters that do not start a new command line or a markdown code block.
     *
     * Inside 'expectedResponse':
     *    (?:...): Non-capturing group, used to group these elements together without remembering their matched content.
     *    (?!^>|```): Negative lookahead. Asserts that what follows is not the start of a new command line (^>) or a markdown code block (```).
     *    [\s\S]: Matches any character, including newlines. \s matches any whitespace character, and \S matches any non-whitespace character. Together, they match any character.
     *    *: Matches zero or more of the preceding element.
     *
     * $: End of a line (because we're using the 'm' flag which makes ^ and $ match start and end of lines respectively)
     *
     * g: Global flag, to find all matches in the string, not just the first one.
     *
     * m: Multiline flag, to allow ^ and $ to match the start and end of lines, not just the start and end of the whole string.
     */
    const commandRegex  = /^> \.(?<command>.+[\r\n])((?<expectedResponse>(?:(?!^>|```)[\s\S])*))$/gm;;
    let match;
    const jeepCliCore = new JeepCliCore();
    while ((match = commandRegex.exec(markdownContent)) !== null) {
        const command = match.groups.command.trim();
        const expectedResponseString = match.groups.expectedResponse.trim();
        const args = command.split(' ');
        if (args.length > 0) {
            const cmdName = args.shift();
            const method = jeepCliCore[cmdName];
            if (typeof method === 'function') {
                const rest = args.join(" ");
                const resp = await method.apply(jeepCliCore, [rest]);
                const respNormalized = JSON.parse(stringify(resp)); //have found that array objects returned by jsonata contain field "sequence=true" that normally don't interfere with use of array but makes jest think objects are different from expected, so we serde it to get rid of hiddden bunk fields
                const expected = JSON.parse(expectedResponseString);
                expect(respNormalized).toEqual(expected);
            } else {
                throw Error(`Unknown command: .${cmdName}`);
            }
        }
    }

});