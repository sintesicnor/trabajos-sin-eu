const xlsx = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '../data/ExcelProduccion.xlsx');
const workbook = xlsx.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// Get headers (first row)
const headers = [];
const range = xlsx.utils.decode_range(worksheet['!ref']);
for (let C = range.s.c; C <= range.e.c; ++C) {
    const cell = worksheet[xlsx.utils.encode_cell({r: 0, c: C})];
    headers.push(cell ? cell.v : undefined);
}

console.log(JSON.stringify(headers, null, 2));
