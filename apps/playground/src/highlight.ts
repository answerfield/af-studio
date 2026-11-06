// Syntax colors for AF; the keywords come from the TextMate grammar Langium generates for VS Code.
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import grammar from '@answerfield/language/syntaxes/af.tmLanguage.json' with { type: 'json' };

const keywordPattern = grammar.patterns.find(p => 'name' in p && p.name === 'keyword.control.af');
const KEYWORD = new RegExp(`^(?:${keywordPattern && 'match' in keywordPattern ? keywordPattern.match : '(?!)'})`);

interface State {
    comment: boolean;
    string: boolean;
}

const af = StreamLanguage.define<State>({
    name: 'af',
    startState: () => ({ comment: false, string: false }),
    token(stream, state) {
        if (state.comment) {
            if (stream.skipTo('*/')) {
                stream.match('*/');
                state.comment = false;
            } else stream.skipToEnd();
            return 'comment';
        }
        if (state.string) {
            while (!stream.eol()) {
                const c = stream.next();
                if (c === '\\') stream.next();
                else if (c === '"') {
                    state.string = false;
                    break;
                }
            }
            return 'string';
        }
        if (stream.eatSpace()) return null;
        if (stream.match('//')) {
            stream.skipToEnd();
            return 'comment';
        }
        if (stream.match('/*')) {
            state.comment = true;
            return 'comment';
        }
        if (stream.eat('"')) {
            state.string = true;
            return 'string';
        }
        if (stream.match(/^\d+(?:[.,]\d+)?/)) return 'number';
        if (stream.match(KEYWORD)) return 'keyword';
        if (stream.match(/^[A-Z]\w*/)) return 'typeName';
        if (stream.match(/^[a-z_]\w*(?=\s*:(?!:))/)) return 'propertyName';
        if (stream.match(/^[a-z_]\w*(?=\s*\()/)) return 'variableName.function';
        if (stream.match(/^[a-z_]\w*/)) return 'variableName';
        stream.next();
        return null;
    },
    languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } } }
});

const style = HighlightStyle.define([
    { tag: tags.comment, color: 'var(--hl-comment)', fontStyle: 'italic' },
    { tag: tags.string, color: 'var(--hl-string)' },
    { tag: tags.number, color: 'var(--hl-number)' },
    { tag: tags.keyword, color: 'var(--hl-keyword)', fontWeight: '600' },
    { tag: tags.typeName, color: 'var(--hl-type)' },
    { tag: tags.propertyName, color: 'var(--hl-property)' },
    { tag: tags.function(tags.variableName), color: 'var(--hl-function)' }
]);

export const afLanguage = [af, syntaxHighlighting(style)];
