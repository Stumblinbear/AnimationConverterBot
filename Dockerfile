FROM jrottenberg/ffmpeg:4.1-alpine

FROM buildkite/puppeteer:latest

# Copy the ffmpeg binaries
COPY --from=0 / /

COPY package*.json ./

RUN npm install

COPY . .

CMD [ "npm", "start" ]