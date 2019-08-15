'use strict'
//our ideal is we edit the csv file, deleting entry or photo
//then program automatically updates the csv file with renames & resizes info
//next does image processing from the csv file
//finally outputs an aggregate csv file

//file system
const path = require('path')
const fs = require('fs');

const folderPath = 'results' //path folder names
const staticAssets = 'static'

//aws s3 bucket upload
const AWS = require('aws-sdk');
// Set the region
const s3 = new AWS.S3({
    apiVersion: '2006-03-01',
    region: 'us-east-2'
});

//our folder structure is
/*
 - nodeJS
  - - photo_automate
  - - - imageProcessing.js -
  - - - auto.js
  - - - results
  - - - static
  - - - - processImg.csv
  - - - - categoryFolder1 (etc.. 8 category folders)
  - - - - categoryFolder2
  - - - - - subset1...(etc)
  - - - - - photo1....lots(etc)
  - - - - - subset1.csv
*/



//cvs file parsing
const parse = require('csv-parse/lib/sync');
const stringify = require('csv-stringify/lib/sync');

const combinedCSV = [];
const csvRoot = path.join(folderPath, 'processImg.csv'); //csv contains all folders that need to be processed.

//img batch processing
const Jimp = require('jimp');

//static assets for img processing, 100, 80 px bmp(.fnt)fonts
const titleFont = `${staticAssets}/font/export2/ptsans_title100.fnt`;
const artistFont = `${staticAssets}/font/export2/ptsans_artist100.fnt`;
const statementFont = `${staticAssets}/font/exportFont/statement80.fnt`;
//white as img background, px size is dpi * (4 x 6)
const backP = `${staticAssets}/testWebP.jpg`; //so only jpeg files are supported for text
const backL = `${staticAssets}/testWebL.jpg`; //so only jpeg files are supported for text

//img configurations
const dpi = 720; //this dpi must be same as printer setting
const maxBig = dpi * 6; //because our print size is max 4in x 6in
const maxSmall = dpi * 4;

const portraitD = { //3 possible orientations, we also need to leave a 4" x 1" area for text
    w: dpi * 4,
    h: dpi * 5,
    //hence our text area is textw: 0- dpi*4
    //h: dpi * 5 to dpi*6
    //max H 720
}

const landscapeSix = { //2 landscapes, we can have 6:3.33 or 5:4 (with image rotated)
    w: dpi * 6,
    h: dpi * 3.33, //same text area as above, so 4 = 6/t
    //hence our text area bounds are  text w: 0- dpi*6
    //text_h: dpi * 3.33, dpi*4
}
// const landscapeFour = { //which of the two we choose are calc by ratio proximity
//     w: dpi * 5,
//     h: dpi * 4
// }

const marginLong = { //text margins for landscape
    sideMargin: (dpi * 6) / (15 * 2),
    vertMargin: (dpi * 4) / (26.67 * 2),
}

const marginShort = { //for portrait
    sideMargin: (dpi * 4) / (15 * 2),
    vertMargin: (dpi * 6) / (26.67 * 2),
}
//720 *4 = 2880
//6*720 = 4320


var staticArray; //contains our loaded static assets.

Promise.all([ //an array of promises, load our static assets :this array order is determined by Promise.all(order1, order2, etc)
        Jimp.read(backP), //loading our static assets, that will be shared across all img processing jobs
        Jimp.read(backL),
        Jimp.loadFont(titleFont),
        Jimp.loadFont(artistFont),
        Jimp.loadFont(statementFont)
    ])
    .then(resultArray => {
        staticArray = resultArray;

        if (fs.existsSync(csvRoot)) { //check for file existence

            console.log('processImg exists')
            const file = fs.readFileSync(csvRoot, { //read csv file of format: Category, SubSet
                encoding: 'utf8'
            });
            const toDo = parse(file, { //gets array of objects, corresponding to cvs records
                // delimiter: ',',
                columns: true,
                skip_empty_lines: true
            });

            toDo.forEach(rec => { //call for every record (every subset folder)
                if (rec.ImgProcessed !== 'y') { //skip if we marked it as done
                    const tipCat = rec.Category; //folder parent
                    const tipSub = rec.Subset;
                    fileRenamer(tipCat, tipSub);
                    rec.ImgProcessed = 'x';
                    //right now fileRenamer automatically leads into img batch
                    // addSize(tipCat, tipSub); //but we should probably seperate the stuff out
                }
            })

            const pushData = stringify(toDo, {
                header: true,
                columns: Object.keys(toDo[0]),
                encoding: 'utf8'
            });
            // fs.writeFileSync(path.join(tipPath, `processed_${_tipSub}.csv`), pushData);
            fs.writeFileSync(csvRoot, pushData);

        } else { //this part has not been tested yet
            console.log('processImg  no exists, now doing everything')
            const allArray = getAllDir();
            allArray.forEach(rec => {
                const tipCat = rec[0];
                if (tipCat !== 'test') { //skip the 'test' folder
                    const tipSub = rec[1];
                    fileRenamer(tipCat, tipSub);
                    // addSize(tipCat, tipSub);
                }
            })
        }

    }).catch(err => console.log("Load Failed: " + err));


function fileRenamer(tipCat, tipSub) { //renames all photo in subset folders

    const tipPath = path.join(folderPath, tipCat, tipSub)
    const csvFile = path.join(tipPath, `${tipSub}.csv`);

    let renameCSV = fs.readFileSync(csvFile, {
        encoding: 'utf8'
    });

    const renameRecs = parse(renameCSV, { //reads thes subset csv file in the subset folder
        // delimiter: ',',
        columns: true,
        skip_empty_lines: true
    });

    let files = fs.readdirSync(tipPath); //reads all files of the folder
    const subset = tipSub; //our subset folder name

    renameRecs.forEach((element) => { //for each subset csv record
        const workerID = element.WorkerId;

        for (let _file of files) {
            //for every individual file in subset folder
            //(note this will includes .csv but workerID won't be the same as csv filename)

            if (_file.includes(workerID)) { //we match by workerID, this assumes workerID is unique among workers
                const ext = path.extname(_file); //gets the file extension of exisitng i.e. (test.jpg => .jpg)
                const newName = subset + '_' + workerID + ext; //photo2_1_A1293183091283.jpg
                fs.renameSync(path.join(tipPath, _file), path.join(tipPath, newName));
                element['Answer.fileName'] = newName;
                element.Size = `4in x 5in test`;
                break;
            }
        }
    });

    addSize(renameRecs, tipPath, tipSub); //await not needed atm because the functions above are all sequential
    console.log('renaming done');
}



const addSize = async (_renameRecs, tipPath, _tipSub) => {
    //runs image processing and then add dimensions to csv file, when finished, add csv file to local subset
    //this is called by every directory that needs to be imgProcessed.
    try {

        await loadImages(tipPath, _renameRecs, imgProcess);
        //we are doing this to guarantee the following code executes after loadImages is finished.
        console.log("running addsize");

        const pushData = stringify(_renameRecs, {
            header: true,
            columns: Object.keys(_renameRecs[0]),
            encoding: 'utf8'
        });
        fs.writeFileSync(path.join(tipPath, `processed_${_tipSub}.csv`), pushData);
        combinedCSV.push(..._renameRecs) //adds all elements of _renameRecs to combined csv

    } catch (err) {
        console.log(err);
    }
}

async function loadImages(_tipPath, _subRecords, callback) {
    //for every local root, run image processing on each photo
    //this is called by every directory that needs to be imgProcessed.
    //cvs iterate
    // console.log('subrecords is: ' + _subRecords);
    for (let entry = 0; entry < _subRecords.length; entry++) { //iterate among all subset csv records
        //i think we cannot use forEach here, if we want to guarantee order
        if (_subRecords[entry]['Answer.fileName']) {
            const _imgPath = path.join(_tipPath, _subRecords[entry]['Answer.fileName']);

            if (fs.existsSync(_imgPath)) {
                //previous problem was when the record was present but file missing
                //added this check

                const info = { //we feed this to our image processing function
                    imgPath: _imgPath, //subset folder
                    filename: _subRecords[entry]['Answer.fileName'], //this is assuming that is the format.
                    subset: _subRecords[entry].Subset,
                    category: _subRecords[entry].Category,
                    size: _subRecords[entry].Size,
                    text: { //to be printed
                        title: _subRecords[entry].Title,
                        statement: _subRecords[entry]['Answer.Statement'],
                        artist: _subRecords[entry]['Answer.ArtName'],
                        year: '2019'
                    }
                };
                let imgProcessResult = await callback(info); // run imgProcess on every record of subset csv
                //this callback is only for imgProcess. we do this so we can await loadImages (to guarantee order for async functions)
                _subRecords[entry].Size = imgProcessResult[0]; //adds new size(dimensions) info to csv
                _subRecords[entry].Portrait = imgProcessResult[1]; //adds if it is portrait or not
            }
        } else {
            _subRecords[entry]['Answer.fileName'] = 'f'
        }
    }
}

const imgProcess = async (_info) => { //we will be feeding this from our CVS search, run on every photo in local root
    try {
        // if (!fs.existsSync(imgPath)) { //check if file exists
        //     return ['file_missing', 'file_missing']; // skips current record
        // }
        const backPortrait = staticArray[0]; //our static assets, order is by Promise.all order
        const backLand = staticArray[1];
        const titleFt = staticArray[2];
        const artistFt = staticArray[3];
        const statementFt = staticArray[4];

        let backCopy;
        let w, h, txtLeft, txtTop, txtBot, maxW, stateLeft, maxHStatement;

        const setTextBounds = (_string, _h) => { //calc the position for our text, need this when we print text onto file
            if (_string === 'portrait') {

                txtLeft = marginShort.sideMargin;
                txtTop = _h + marginShort.vertMargin;
                txtBot = maxBig - marginShort.vertMargin;
                maxW = (maxSmall / 2) - (txtLeft);
                stateLeft = (maxSmall / 2) + (txtLeft / 2);
                maxHStatement = maxBig - _h - (marginShort.vertMargin * 2);

                backCopy = backPortrait.clone(); //clones a copy of our static assets so we can reuse

            } else { //landscape mode

                txtLeft = marginLong.sideMargin;
                txtTop = _h + marginLong.vertMargin;
                txtBot = maxSmall - marginLong.vertMargin;
                maxW = (maxBig / 2) - (txtLeft);
                stateLeft = (txtLeft / 2) + (maxBig / 2);
                maxHStatement = maxSmall - _h - (marginLong.vertMargin * 2);

                backCopy = backLand.clone();
            }
        };


        const img = await Jimp.read(_info.imgPath); //our img file
        img.background(0x00000000)
            .quality(100)

        const scalePortrait = Math.min(4 / img.bitmap.width, 5 / img.bitmap.height);
        const scaleLandscape = Math.min(6 / img.bitmap.width, 3.33 / img.bitmap.height);
        const _portrait = (Math.abs(scalePortrait) > Math.abs(scaleLandscape)) ? true : false;
        // console.log("portrait is:" + _portrait);


        if (_portrait) { //all we need to do is guarantee the areas are the
            w = portraitD.w; //we can rotate this 90 or -90 after laying text if 5:4
            h = portraitD.h;
            setTextBounds('portrait', h);

        } else { //there is no objective answer whether this or 5000 x 4000 is better. What matters only is whether the
            //the photo dimension ratio is more close to 6:3.33 or 5:4 // and we can set this programtically.
            w = landscapeSix.w;
            h = landscapeSix.h;
            setTextBounds('landscape', h);
            // if (six) {
            //     w = landscapeSix.w;
            //     h = landscapeSix.h;
            //     setTextBounds('landscape', h);
            // } else {
            //     w = landscapeFour.w;
            //     h = landscapeFour.h;
            //     setTextBounds('portrait', w); //pass w because we have to rotate, so w becomes h and vice versa

            // }
        }

        img.scaleToFit(w, h);

        const imgXCenter = img.bitmap.width / 2;
        const imgYCenter = img.bitmap.height / 2;
        const placeX = (w / 2) - imgXCenter;
        const placeY = (h / 2) - imgYCenter; //our placement X,y s to center the image, regrettably this package cannot center


        const imgWeb = img.clone(); //a low-res web version
        imgWeb.scaleToFit(dpi * 2, dpi * 2); //does this preserve ratio?
        // console.log('_info.category is:' + _info.category)
        // , _info.category, 'print', _info.filename);
        const webPath = path.join(folderPath, _info.category, _info.subset, 'web', _info.filename);
        imgWeb.writeAsync(webPath).then(() => { //upload low res to aws s3 bucket
                s3Upload(webPath, _info.category, _info.subset);
            })
            .catch(err => console.log(err));



        //text stuff
        const printWidth = (img.bitmap.width / dpi).toFixed(2) + "in"; //get physical dimensions to be printed later
        const printHeight = (img.bitmap.height / dpi).toFixed(2) + "in";
        const dimensions = `${printWidth} x ${printHeight} unique print.`;

        //
        //2.5 because we inc from topline (textTop), we need to factor in lineHeight + measure which is 1.5
        //that is the theory but not sure why is it wonky
        const printText = _info.text;
        const textHigh = (Jimp.measureTextHeight(artistFt, printText.artist, maxW)); //this is not working
        // console.log(txtTop);
        // console.log(textHigh);

        backCopy.opaque()
            // .print(fontload, sideMargins, h + vertMargins, 'The Quick Brown Fox Jumps Over The Lazy Dog', dpi * 2.8, 1000) //it was being covered up thats why
            .print(artistFt, txtLeft, txtTop, {
                text: printText.artist,
                alignmentY: Jimp.VERTICAL_ALIGN_TOP
            }, maxW)
            .print(statementFt, txtLeft, txtTop + (1.25 * textHigh), { //dimensions and year
                text: `${dimensions}  2019`,
                alignmentY: Jimp.VERTICAL_ALIGN_TOP
            }, maxW)
            // .print(artistFt, txtLeft, txtTop + textHigh, printText.artist, maxW) //txtTop + textHigh, because we count from top line,
            .print(titleFt, txtLeft, txtBot - (1.25 * textHigh), {
                text: printText.title,
                alignmentY: Jimp.VERTICAL_ALIGN_BOTTOM
            }, maxW) //txtTop + textHigh, because we count from top line,
            .print(statementFt, stateLeft, txtTop, printText.statement, maxW, maxHStatement)
            .composite(img, placeX, placeY, {
                mode: Jimp.BLEND_SOURCE_OVER
            });

        if (!_portrait) { //rotating because our printer requires output file to be in 4x6 format.
            backCopy.rotate(90);
        }


        backCopy.quality(100)
            .writeAsync(path.join(folderPath, _info.category, 'print', _info.filename));

        return [dimensions, _portrait];

    } catch (err) {
        console.log(err);
    }
}


function getAllDir() { //2nd level recursive search of folders, returns parent-child folder pushed into allDirectory arr

    const allDirectory = [];
    for (let categoryPath of getDirectories(folderPath)) {

        const subsets = getDirectories(path.join(folderPath, categoryPath));
        subsets.forEach(subsetPath => {
            // const tipPath = path.join(folderPath, categoryPath, subsetPath)
            const arr = [categoryPath, subsetPath];
            allDirectory.push(arr);
        })
    }
    return allDirectory;
}

const getDirectories = src =>
    fs.readdirSync(src, {
        withFileTypes: true
    }).filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);




function s3Upload(uploadPhoto, category, subset) { //upload web-photos to amazon s3 bucket
    // Load the SDK for JavaScript

    // call S3 to retrieve upload file to specified bucket
    const uploadParams = {
        Bucket: `public-vending/${category}/${subset}`,
        Key: '',
        Body: ''
    };

    let fileStream = fs.createReadStream(uploadPhoto);
    fileStream.on('error', function (err) {
        console.log('File Error', err);
    });
    uploadParams.Body = fileStream;
    uploadParams.Key = path.basename(uploadPhoto);

    // call S3 to retrieve upload file to specified bucket
    s3.upload(uploadParams, function (err, data) {
        if (err) {
            console.log("Error", err);
        }
        if (data) {
            console.log("Upload Success", data.Location);
        }
    });
}