'use strict'

//given a csv file
//upload csv record contents to webflow, via webflow cms api
//the webflow cms api requires the following:
//1. webflow ID of the item, which we pull from webflow
//2. category ID of "Products", which we pull from webflow but just hardcode since it is not going to change
//3. id of what category the item belongs to, which we pull from webflow


//mode
const settingArchived = false; //when we want to setArchive instead of patching items, usually set to false
const updateCatCSV = false; //if we want to update cat info (name: id) or use existing from csv

//filesystem
const fs = require('fs');
const path = require('path');

//csv
const parse = require('csv-parse/lib/sync');
const stringify = require('csv-stringify/lib/sync');

//csv paths
const folderPath = `./results`;
const csvRoot = path.join(folderPath, 'processImg.csv'); //csv contains all images that need to be processed.
const categoryCSV = path.join(folderPath, 'category_webflow.csv');
console.log(csvRoot) //our root csv file of Category: value, Subset: Value, which tells us which folders to upload to webflow


//webflow stuff
const Webflow = require('webflow-api');
const webfKey = 'sljfsiaofj9809182318-0fajsfjaoo'; //our webflow api key
const webflow = new Webflow({
    token: webfKey
});
const productsID = '5d09d44d3d6e1c722aa96402'; //csm api, _id of our 'products' collection.


var idArray = []; //we store 'TeSt' item records we pull from csm here, later we will be updating these
var existingArray = [] //store webflow cms with existing names here
var rateCount = 0; //cms api is limited to 60 api requests per minute, when rateCount >=60, sleep for 1 minute
var count = 0; //tracking how much stuff we have done, not really needed more for logging

var categories = []; //empty category we declare, later we push the contents of our categories as MakeCategory objects

function MakeCategory(_name, _id) { //we push this into categories[]
    //for categories
    this.name = _name;
    this.id = _id;
    // this.arr = []; //, this.arr is not used but might as well keep to remain in sync with our backend
};


function sleep(ms) { //sleep function, used only in async functions with await sleep(milliseconds) ; 60000 = 1 minute
    return new Promise(resolve => setTimeout(resolve, ms));
}


async function main() {
    try {

        if (updateCatCSV) {
            await initCats(); //update cats function, not usually run but we should do so periodically
            return;

        } else {

            const catfile = fs.readFileSync(categoryCSV, { //read csv file of format: Category, SubSet
                encoding: 'utf8'
            });
            const catCSV = parse(catfile, {
                // delimiter: ',',
                headers: true,
                columns: true,
                skip_empty_lines: true
            });
            catCSV.forEach(ele => categories.push(new MakeCategory(ele.name, ele.id)))

            await init();
            // console.log(idArray)
            await sleep(60000); //sleeping for 1 min, because we want to guarantee not exceeding rate limits

            if (settingArchived) {
                archiveTeSt();

            } else {

                if (fs.existsSync(csvRoot)) { //check existence, the path is a bit funky, we might need the absolute path?
                    console.log('processImg exists')

                    const file = fs.readFileSync(csvRoot, { //read csv file of format: Category, SubSet
                        encoding: 'utf8'
                    });
                    const rootCSV = parse(file, {
                        // delimiter: ',',
                        headers: true,
                        columns: true,
                        skip_empty_lines: true
                    });

                    for (let entry = 0; entry < rootCSV.length; entry++) {
                        if ((rootCSV[entry].ImgProcessed === 'x') && (rootCSV[entry].Uploaded !== 'x')) {
                            // this called for every subfolder that our root csv file references

                            const tipCat = rootCSV[entry].Category;
                            const tipSub = rootCSV[entry].Subset;
                            const csvPath = path.join(folderPath, tipCat, tipSub, `processed_${tipSub}.csv`);
                            // console.log(csvPath)

                            const subFiles = fs.readFileSync(csvPath, { //read the csv file in the subfolder
                                encoding: 'utf8'
                            });
                            const subCSV = parse(subFiles, { //parse it to an array of objects
                                // delimiter: ',',
                                headers: true,
                                columns: true,
                                skip_empty_lines: true
                            });
                            // console.log(tipOutput)
                            const done = patchItems(subCSV); //call patch for each csv record
                            rootCSV[entry].Uploaded = done;
                        }
                    }

                }
                // } else {
                //     console.log('processImg  no exists, now doing everything')
                //     const allArray = getAllDir();
                //     allArray.forEach(rec => {
                //         const tipCat = rec[0];
                //         if (tipCat !== 'test') {
                //             const tipSub = rec[1];
                //             initCats();
                //             // addSize(tipCat, tipSub);
                //         }
                //     })
                // }
            }

        }
    } catch (err) {
        console.log(err);
    }

};

//webflow cms code begins below

async function initCats() {
    //find _id of categories etc. These are actually items which belong to collection "category"
    try {
        console.log('initCats')
        const categoryItem = await webflow.items({ //gets all items of a collection
            collectionId: '5d09d44d3d6e1c6084a9642e' //collection id of 'category'
        }, {
            limit: 50
        });
        //the response format is {items: [{},{},...}], count: , etc, }
        // console.log("categoryItem:  " + categoryItem);
        const tempCat = categoryItem.items; //an array of objects containing all our items
        // console.log("tempCat  " + JSON.stringify(tempCat));
        for (let i = 0; i < tempCat.length; i++) {
            //console.log(tempCat[i]);
            const copyCat = new MakeCategory(tempCat[i].description, tempCat[i]._id);
            //makes an object of {name: racism, id: f1323121, arr:[]}
            //to alter which field we match by , change the name --> tempCat[i].example
            categories.push(copyCat);
        }

        const pushData = stringify(categories, {
            header: true,
            columns: Object.keys(categories[0]),
            encoding: 'utf8'
        });

        fs.writeFileSync(path.join(folderPath, `category_webflow.csv`), pushData);

        // console.log(categories);
    } catch (err) {
        console.log(err);
    }
}

async function init() {
    try {
        console.log('init')
        const itemCount = await webflow.items({ // to get total item count of our webflow cms items (itemCount.total)
            collectionId: productsID //collection id of products
        });

        const whole = Math.floor(itemCount.total / 100); //finds lowest  750, 7 calls, Ceiling doesn't work when items<100
        console.log(whole);
        for (let j = 0; j <= whole; j++) { //<= because we really need to make count+1 calls, but offset needs to start at 1
            let tempObjs = await webflow.items({ //we get an object back with items being an arrary
                collectionId: productsID
            }, {
                limit: 100,
                offset: 100 * j
            });
            tempObjs.items.forEach(ele => {
                ele.patched = false;
                if (ele.name.includes('TeSt')) {
                    idArray.push(ele);
                } else {
                    existingArray.push(ele);
                }

            })
            // idArray.push(...tempObjs.items); //... copies array contents only but not array itself
        }

    } catch (err) {
        console.log(err);
    }
}



async function patchItems(records) {
    try {
        console.log('patching')
        // console.log(idArray)
        for (let i = 0; i < records.length; i++) {
            if (records[i].Size !== 'f') { //otherwise we skip
                // console.log("inside records[i]:" + records[i]);
                const element = records[i];

                const filename = element['Answer.fileName'];
                const category = element.Category;
                const subset = element.Subset;
                const portrait = (element.Portrait === '1') ? true : false;

                let _itemId;

                // let str = JSON.stringify(subset + element.Title + 'abc').replace(/\W/g, '').toLowerCase();
                //iterate among all idArray
                //if it has our str, we match by id and just update old records
                //otherwise choose a random one that has 'TeSt' as name


                const existing = () => {
                    for (let i = 0; i < existingArray.length; i++) {
                        if (existingArray[i].name === element.Title) {
                            _itemId = existingArray[i]._id;
                            existingArray[i].patched = true;
                            return true;
                        }
                    }
                }
                if (!existing()) {
                    for (let obj = 0; obj < idArray.length; obj++) {
                        //the problem here is it needs to guarantee checking name before proceeding to TeSt
                        if (idArray[obj].name.includes('TeSt') && (idArray[obj].patched === false)) { //otherwise choose a new random one
                            // console.log('has test')
                            console.log(idArray[obj]._id);
                            _itemId = idArray[obj]._id;
                            idArray[obj].patched = true;
                            break;
                        }
                    }
                }

                const categoryID = (() => { //we need this for the cms api/
                    for (let cat of categories) { //look up cms id of category in categories array
                        if (cat.name === category) {
                            // console.log('cat.id lookup is: ' + cat.id)
                            return cat.id;
                        }
                    }
                })();
                //calucalte category ID from webflow match.

                //what i suspect is happening
                //is because we deleted some of the ones previously
                //we perhaps also need to delete the corresponding SKU id
                //we will test PATCH with live = true, if this still doesn't work
                // we wil implement a delete SKU id function

                rateCount++; //ratecount check
                if (rateCount >= 40) {
                    console.log('over rateCount, pausing for 1 minute')
                    await sleep(60000)
                    rateCount = 0;
                }
                //get collection items;
                //patch by sequence
                console.log(_itemId);
                //previously the _itemId was undefined when ratelimit was reached for initCats & init

                const webflowUrl = `https://api.webflow.com/collections/${productsID}/items/${_itemId}?live=true`;

                let setZero = await fetch(webflowUrl, { //ok this works now, it was try catch error
                    method: 'PATCH', //trying put
                    headers: { // this works
                        'Content-Type': 'application/json',
                        'accept-version': '1.0.0',
                        'Authorization': `Bearer ${webfKey}`
                    },
                    body: JSON.stringify({ //this works
                        fields: {
                            // slug: str,
                            name: element.Title,
                            description: element['Answer.Statement'],
                            'short-description': element['Answer.ArtName'],
                            category: [categoryID],
                            portrait: portrait,
                            'type-2': categoryID,
                            'filename-3': filename,
                            'size': element.Size,
                            'imglink': `https://public-vending.s3.us-east-2.amazonaws.com/${category}/${subset}/${filename}`,
                            _archived: false, //so this works.,
                        }
                    }),
                });
                // console.log(`link is: https://public-vending.s3.us-east-2.amazonaws.com/${category}/${subset}/${filename}`)
                // const jsonRes = await setZero.json(); //JSON response of setZero
                // console.log(jsonRes);
                count++; //inc our total processed count
                console.log('patched:' + count)
                return 'x';

            }
        }
    } catch (err) {
        console.log(err);
    }
}

async function archiveTeSt() {
    try {

        for (let obj of idArray) {
            if (obj.name.includes('TeSt') && obj._archived == true) { //otherwise choose a new random one
                let _itemId = obj._id;

                rateCount++;
                if (rateCount >= 40) {
                    console.log('over rateCount, pausing for 1 minute')
                    await sleep(60000)
                    rateCount = 0;
                }


                const webflowUrl = `https://api.webflow.com/collections/${productsID}/items/${_itemId}`;

                let setZero = await fetch(webflowUrl, { //ok this works now, it was try catch error
                    method: 'PATCH',
                    headers: { // this works
                        'Content-Type': 'application/json',
                        'accept-version': '1.0.0',
                        'Authorization': `Bearer ${webfKey}`
                    },
                    body: JSON.stringify({ //this works
                        fields: {
                            _archived: false //so this works.
                        }
                    }),
                });
                const jsonRes = await setZero.json(); //JSON response of setZero
                console.log('setting 1 test to archived');
                console.log(jsonRes);
            }
        }
    } catch (err) {
        console.log(err);
    }
}

main();

//misc currently not used funcs

function checkDelete() { //when we want to delete useless photos
    // for each entry, check by del, if del = x, delete corresponding file
    console.log(records);
    let i = 0;
    records.forEach(element => {
        if (element.del === 'x') {
            //deleteFile(element.WorkerId + append + element['Answer.fileName']);
            //delete corresponding local file.
        } else {

            patchItems(element, i);
            i++;

        }
    });
}

function deleteFile(_file) {

    fs.unlink(folderPath + _file, (err) => {
        if (err) {
            console.log("failed delete:  " + err);
        } else {
            console.log("file delete success");
        }
    });
}

// const collection = await webflow.collection({ //what is tihs for?
//     collectionId: productsID
// });
// console.log(collection);

// webflow.collection({
//     collectionId: '5d09d44d3d6e1c722aa96402'
// }).then(res => console.log(res)).catch(err => console.log(err));