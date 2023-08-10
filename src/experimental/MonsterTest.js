// Importing the required classes from the generated code
const flatbuffers = require('flatbuffers');
const MyGame = require('../../flatbuffers/dist/my-game/sample');
const jsonata = require('jsonata')
const Monster = MyGame.Monster;
const Weapon = MyGame.Weapon;
const Vec3 = MyGame.Vec3;
const Color = MyGame.Color;

// Creating a FlatBuffer Builder
const builder = new flatbuffers.Builder();

// Create weapons vector
const weaponName1 = builder.createString('Sword');
const weaponName2 = builder.createString('Axe');
Weapon.startWeapon(builder);
Weapon.addName(builder, weaponName1);
Weapon.addDamage(builder, 50);
const weapon1 = Weapon.endWeapon(builder);
Weapon.startWeapon(builder);
Weapon.addName(builder, weaponName2);
Weapon.addDamage(builder, 30);
const weapon2 = Weapon.endWeapon(builder);
const weapons = Monster.createWeaponsVector(builder, [weapon1, weapon2]);

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

function Vec3Facade(vec3) {
    return new Proxy(vec3Shell, {
        get(_, key) {
            if (key in vec3Shell) {
                return vec3[key]();
            }
        },
    });
}

function WeaponFacade(weapon) {
    return new Proxy(weaponShell, {
        get(_, key) {
            if (key in weaponShell) {
                return weapon[key]();
            }
        },
    });
}

function EquipmentFacade(equipment) {
    // You may extend this logic if there are more types in the Equipment union
    if (equipment instanceof MyGame.Weapon) {
        return WeaponFacade(equipment);
    }
}

function MonsterFacade(monster) {
    return new Proxy(monsterShell, {
        get(_, key) {
            switch (key) {
                case 'pos':
                    return Vec3Facade(monster.pos());
                case 'weapons':
                    return ArrayProxy(i => monster.weapons(i), WeaponFacade, monster.weaponsLength());
                case 'path':
                    return ArrayProxy(i => monster.path(i), Vec3Facade, monster.pathLength());
                case 'equipped':
                    return EquipmentFacade(monster.equipped());
                case 'inventory':
                    return ArrayProxy(i => monster.inventory(i), x => x, monster.inventoryLength());
                default:
                    if (key in monsterShell) {
                        return monster[key]();
                    }
            }
        },
    });
}

function ArrayProxy(vectorGetter, facade, length) {
    return new Proxy(sharedNullArray.slice(0, length), {
        get(_, index) {
            if (index === 'length') return length;
            if (typeof index === 'string' && isNaN(index)) return sharedNullArray[index];
            return facade(vectorGetter(index));
        },
    });
}
const monsterObject = Monster.getRootAsMonster(new flatbuffers.ByteBuffer(builder.asUint8Array()));
const myMonster = MonsterFacade(monsterObject);


//from "user" POV, myMonster behaves like an ordinary json object
console.log(JSON.stringify(myMonster)); // Output: 'MyMonster'
//and we can use any JSONata expression to process over it
(async ()=> {
    let i;
    const expr = jsonata("weapons.(damage)~>$sum");
    const startTime = Date.now();
    const iterations = 100000;
    let out;
    for(let i = 0; i < iterations; i++) {
         out = await expr.evaluate(myMonster);
    }

    const endTime = Date.now();
    const totalTime = endTime - startTime; // Total time in milliseconds
    const averageTime = totalTime / iterations; // Average time per iteration in milliseconds
    const executionsPerSecond = 1000 / averageTime; // Executions per second

    console.log('Average time per iteration:', averageTime, 'milliseconds');
    console.log('Executions per second:', executionsPerSecond);
    console.log(JSON.stringify(out));

})();



