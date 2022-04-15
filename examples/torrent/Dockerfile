FROM node:alpine
WORKDIR /app

COPY index.js ./
COPY package.json ./

RUN npm install

CMD ["node", "index.js", "30162"]
