// Importing the required classes from the generated code
const flatbuffers = require('flatbuffers');
const MyGame = require('../flatbuffers/dist/my-game/sample');
const Monster = MyGame.Monster;

// Creating a FlatBuffer Builder
const builder = new flatbuffers.Builder();

// Example of creating a new Monster
Monster.startMonster(builder);
Monster.addHp(builder, 300);
const orc = Monster.endMonster(builder);

builder.finish(orc);

// Example of reading the Monster
const buf = builder.asUint8Array();
const monster = Monster.getRootAsMonster(new flatbuffers.ByteBuffer(buf));

console.log('Monster HP:', monster.hp());