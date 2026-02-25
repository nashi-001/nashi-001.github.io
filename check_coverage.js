
const fs = require('fs');

// Mocking the environment to read the files
const databaseContent = fs.readFileSync('c:/Users/1.DESKTOP-6BBNTKN/Documents/GoogleAntiGravity/test/kanji/kanji_database.js', 'utf8');
const poolContent = fs.readFileSync('c:/Users/1.DESKTOP-6BBNTKN/Documents/GoogleAntiGravity/test/kanji/sentence_pool.js', 'utf8');

// Extract KANJI_BY_GRADE
const kanjiByGradeMatch = databaseContent.match(/const KANJI_BY_GRADE = ({[\s\S]+?});/);
const kanjiByGrade = eval('(' + kanjiByGradeMatch[1] + ')');

const allKanji = new Set();
for (const grade in kanjiByGrade) {
    for (const char of kanjiByGrade[grade].replace(/\s/g, '')) {
        allKanji.add(char);
    }
}

console.log('Total Kanji in database:', allKanji.size);

// Extract SENTENCE_POOL
const sentencePoolMatch = poolContent.match(/const SENTENCE_POOL = (\[[\s\S]+?\]);/);
const sentencePool = eval('(' + sentencePoolMatch[1] + ')');

const coveredKanji = new Set();
sentencePool.forEach(sentence => {
    for (const word in sentence.words) {
        for (const char of word) {
            coveredKanji.add(char);
        }
    }
});

console.log('Total Kanji covered in pool:', coveredKanji.size);

const missingKanji = [];
allKanji.forEach(kanji => {
    if (!coveredKanji.has(kanji)) {
        missingKanji.push(kanji);
    }
});

console.log('Missing Kanji count:', missingKanji.length);
console.log('Missing Kanji sample:', JSON.stringify(missingKanji.slice(0, 100)));
console.log('Missing Kanji (full list):', JSON.stringify(missingKanji));
