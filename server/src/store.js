import fs from "node:fs";
import path from "node:path";
const file = path.resolve("./data.json");
const seed = { users:[], bills:[], incomes:[] };
export function readDB(){
  if(!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(seed,null,2));
  try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return structuredClone(seed)}
}
export function writeDB(db){fs.writeFileSync(file,JSON.stringify(db,null,2))}
export function id(){return `${Date.now()}_${Math.random().toString(36).slice(2,9)}`}
