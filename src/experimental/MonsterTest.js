// Importing the required classes from the generated code
'use strict';
const flatbuffers = require('flatbuffers');
const MyGame = require('../../flatbuffers/dist/my-game/sample');
const jsonata = require('jsonata');
const profiler = require('v8-profiler-next');
// set generateType 1 to generate new format for cpuprofile
// to be compatible with cpuprofile parsing in vscode.
profiler.setGenerateType(1);

const Monster = MyGame.Monster;
const Weapon = MyGame.Weapon;
const Vec3 = MyGame.Vec3;
const Color = MyGame.Color;

// Creating a FlatBuffer Builder
const builder = new flatbuffers.Builder();

// Create weapons vector
let i=0;
const tmp = [];
for(i=0;i<100;i++) {
    const weaponName1 = builder.createString('Sword');
    Weapon.startWeapon(builder);
    Weapon.addName(builder, weaponName1);
    Weapon.addDamage(builder, 50);
    const weapon1 = Weapon.endWeapon(builder);
    tmp.push(weapon1);
}

const weapons = Monster.createWeaponsVector(builder, tmp);

// Create a name for our myMonster
const name = builder.createString('MyMonster');

// Create a Vec3 struct object for the position
const pos = Vec3.createVec3(builder, 1.0, 2.0, 3.0);

// Create the Monster object
Monster.startMonster(builder);
Monster.addPos(builder, pos);
Monster.addMana(builder, 150);
Monster.addHp(builder, 100);
Monster.addName(builder, name);
Monster.addColor(builder, Color.Blue);
Monster.addWeapons(builder, weapons);
const monster = Monster.endMonster(builder);

builder.finish(monster);


//These 'shell' objects are singletons. Across many Monster that we would need to operate on
//they all share these exact instances. So these few bytes are a one-time allocation.
const vec3Shell = { x: null, y: null, z: null };
const weaponShell = { name: null, damage: null };
const monsterShell = {
    pos: vec3Shell,
    mana: null,
    hp: null,
    name: null,
    inventory: null,
    color: null,
    weapons: null,
    equipped: null,
    path: null
};


//This singleton supports arrays that need to be proxied. It exists only so ArrayProxy can have a slice of it
//so that every array method is supported
const sharedNullArray = new Array(1000).fill(null);

// Instead of wrapping an entirely new proxy for every new FlatBuffers object,
// We'll reset the underlying data for our singletons.
function setVec3Data(vec3Shell, vec3) {
    vec3Shell.data = vec3;
}

function setWeaponData(weaponShell, weapon) {
    weaponShell.data = weapon;
}

function setMonsterData(monsterShell, monster) {
    monsterShell.data = monster;
}

const vec3Facade = new Proxy(vec3Shell, {
    get(_, key) {
        if (key in vec3Shell && typeof vec3Shell.data[key] === "function") {
            return vec3Shell.data[key]();
        }
    },
});

const weaponFacade = new Proxy(weaponShell, {
    get(_, key) {
        if (key in weaponShell && typeof weaponShell.data[key] === "function") {
            return weaponShell.data[key]();
        }
    },
});

const monsterFacade = new Proxy(monsterShell, {
    get(_, key) {
        switch (key) {
            case 'pos':
                setVec3Data(vec3Shell, monsterShell.data.pos());
                return vec3Facade;
            case 'weapons':
                return ArrayProxy(i => monsterShell.data.weapons(i), setWeaponData, weaponFacade, monsterShell.data.weaponsLength());
            case 'path':
                return ArrayProxy(i => monsterShell.data.path(i), setVec3Data, vec3Facade, monsterShell.data.pathLength());
            case 'inventory':
                return ArrayProxy(i => monsterShell.data.inventory(i), x => x, null, monsterShell.data.inventoryLength()); // Assuming inventory is of basic type
            default:
                if (key in monsterShell && typeof monsterShell.data[key] === "function") {
                    return monsterShell.data[key]();
                }
        }
    },
});

function ArrayProxy(vectorGetter, setDataFunc, facade, length) {
    return new Proxy(sharedNullArray.slice(0, length), {
        get(_, index) {
            if (index === 'length') return length;
            if (typeof index === 'string' && isNaN(index)) return sharedNullArray[index];
            const item = vectorGetter(index);
            //setDataFunc(facade, item);
            weaponShell.data = item;
            return facade;
        },
    });
}

// [rest of the code ...]

const monsterObject = Monster.getRootAsMonster(new flatbuffers.ByteBuffer(builder.asUint8Array()));
setMonsterData(monsterShell, monsterObject);


//from "user" POV, myMonster behaves like an ordinary json object
console.log(JSON.stringify(monsterFacade)); // Output: 'MyMonster'
//and we can use any JSONata expression to process over it
(async ()=> {
    let i;
    const expr = jsonata("weapons.(damage)~>$sum");
    const startTime = Date.now();
    const iterations = 100000;
    let out;
    profiler.startProfiling('test', true);
    for(let i = 0; i < iterations; i++) {
        const monsterObject = Monster.getRootAsMonster(new flatbuffers.ByteBuffer(builder.asUint8Array()));
        setMonsterData(monsterShell, monsterObject);
        out = await expr.evaluate(monsterFacade);
    }
    const p = profiler.stopProfiling('test');

    // Save the profile to a file
    const fs = require('fs');
    p.export((error, result) => {
        fs.writeFileSync('profile.cpuprofile', result);
        p.delete();
        console.log("Profile saved.");
    });

    const endTime = Date.now();
    const totalTime = endTime - startTime; // Total time in milliseconds
    const averageTime = totalTime / iterations; // Average time per iteration in milliseconds
    const executionsPerSecond = 1000 / averageTime; // Executions per second

    console.log('Average time per iteration:', averageTime, 'milliseconds');
    console.log('Executions per second:', executionsPerSecond);
    console.log(JSON.stringify(out));

})();



