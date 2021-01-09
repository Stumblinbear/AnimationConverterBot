const fs = require('fs');
const zlib = require('zlib');

const renderLottie = require('puppeteer-lottie');
const DEFAULT_BACKGROUND = '#5B99BC';

const ffmpeg = require('ffmpeg');
const FORMATS = ['mp4', 'swf'];

const { Storage } = require('@google-cloud/storage');
const storage = new Storage();
const userFile = storage.bucket(process.env.BUCKET_ID).file(process.env.USERS_FILE);

const TelegramBot = require('node-telegram-bot-api');

let users;

function createBot() {
    if(process.env.TELEGRAM_BOT_WEBHOOK) {
        const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
        bot.setWebHook(`${process.env.TELEGRAM_BOT_WEBHOOK}/bot/${process.env.TELEGRAM_BOT_TOKEN}`);
    
        const express = require('express');
        const app = express();
        app.use(express.json());
        app.post(`/bot/${process.env.TELEGRAM_BOT_TOKEN}`, (req, res) => {
        bot.processUpdate(req.body);
            res.sendStatus(200);
        });
        app.listen(port);

        return bot;
    }else{
        return new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
    }
}

function loadUsers() {
    return new Promise((resolve, reject) => {
        const chunks = [];

        userFile.createReadStream()
            .on('data', chunk => chunks.push(chunk))
            .on('error', reject)
            .on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

async function saveUsers() {
    return new Promise((resolve, reject) => {
        if(!users) return reject();

        const stream = userFile.createWriteStream({ resumable: false });
        
        stream.write(JSON.stringify(users, null, 4), reject);

        stream.end(resolve);
    });
}

(async () => {
    users = await loadUsers();

    const bot = createBot();

    bot.on('message', async (msg) => {
        if(msg.from.is_bot) return;

        const user = {
            username: msg.from.username,
            first_name: msg.from.first_name,
            last_name: msg.from.last_name,
            language_code: msg.from.language_code,
            format: 'mp4'
        };

        if(users[msg.from.id]) {
            user.background = users[msg.from.id].background;
            user.format = users[msg.from.id].format;
        }

        users[msg.from.id] = user;

        await saveUsers();
    });

    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id, 'Send me an animated sticker and I\'ll convert it to an MP4.');
    });

    bot.onText(/\/bg (#([\da-fA-F]+)|reset)$/, (msg, match) => {
        if(match[1] == 'reset') {
            delete users[msg.chat.id].background;
        
            bot.sendMessage(msg.chat.id, 'Background color reset to default.');

            return;
        }

        users[msg.chat.id].background = match[1];

        bot.sendMessage(msg.chat.id, 'Background color changed to ' + users[msg.chat.id].background);
    });

    bot.onText(/\/bg (data:image\/(.+?);base64,(?:.+))$/, (msg, match) => {
        users[msg.chat.id].background = 'url("' + match[1] + '")';

        bot.sendMessage(msg.chat.id, 'Background changed to image.');
    });

    bot.onText(/\/format (.+)/, (msg, match) => {
        if(!FORMATS.includes(match[1])) {
            bot.sendMessage(msg.chat.id, 'Unsupported format.');
            return;
        }

        users[msg.chat.id].format = match[1];

        bot.sendMessage(msg.chat.id, 'Output format changed to ' + users[msg.chat.id].format);
    });

    bot.on('message', (msg) => {
        let fileId = null;

        if(msg.animation) {
            if(msg.animation.mime_type != 'video/mp4') return;
            
            fileId = msg.animation.file_id;
        }else if(msg.video) {
            if(msg.video.mime_type != 'video/mp4') return;
            
            fileId = msg.video.file_id;
        }else if(msg.document) {
            if(msg.document.mime_type != 'video/mp4') return;
            
            fileId = msg.document.file_id;
        }else{
            return;
        }

        const format = users[msg.chat.id].format;

        if(format == 'mp4') return;

        const file = 'temp/' + msg.sticker.file_unique_id;

        bot.getFileStream(fileId)
            .pipe(fs.createWriteStream(file + '.mp4'))
            .on('finish', () => {
                try {
                    new ffmpeg(file + '.mp4').then(function (video) {
                        video.save(file + '.' + format, function (error, file) {
                            if(error) {
                                console.error(error);
                                return;
                            }
                            
                            console.log(file);
                            
                            bot.sendDocument(msg.chat.id, fs.createReadStream(file));
                        });
                    }, function (err) {
                        console.log('Error: ' + err);
                    });
                } catch (e) {
                    console.error(e.code);
                    console.error(e.msg);
                }
            });
    });

    bot.on('sticker', (msg) => {
        if(!msg.sticker.is_animated) {
            return bot.sendMessage(msg.chat.id, 'The sticker must be animated.');
        }
        
        bot.sendMessage(msg.chat.id, 'Converting sticker, please wait...');

        const user = users[msg.chat.id];

        const file = 'temp/' + msg.sticker.file_unique_id;

        bot.getFileStream(msg.sticker.file_id)
            .pipe(fs.createWriteStream(file + '.tgs'))
            .on('finish', () => {
                fs.createReadStream(file + '.tgs')
                    .pipe(zlib.createGunzip())
                    .pipe(fs.createWriteStream(file + '.json'))
                    .on('finish', () => {
                        renderLottie({
                            path: file + '.json',
                            output: file + '.mp4',
                            inject: {
                                style: 'body { background: ' + (user.background || DEFAULT_BACKGROUND) + '; background-size: cover; }'
                            },
                            renderer: 'svg',
                            width: 1024,
                            height: 1024
                        }).then(() => {
                            if(user.format == 'mp4')
                                bot.sendVideo(msg.chat.id, fs.createReadStream(file + '.mp4'));
                            else{
                                try {
                                    new ffmpeg(file + '.mp4').then(function (video) {
                                        video.save(file + '.' + user.format, function (error, file) {
                                            if(error) {
                                                console.error(error);
                                                return;
                                            }
                                            
                                            console.log(file);
                                            
                                            bot.sendDocument(msg.chat.id, fs.createReadStream(file));
                                        });
                                    }, function (err) {
                                        console.log('Error: ' + err);
                                    });
                                } catch (e) {
                                    console.error(e.code);
                                    console.error(e.msg);
                                }
                            }
                        });
                    });
            });
    });
})();