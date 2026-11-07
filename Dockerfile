ARG RUNTIME_IMAGE=registry.spirit.t-education.com/cicd-images/example-frontend-deps:latest
FROM ${RUNTIME_IMAGE}

WORKDIR /app

# TravelHub has no compile step and uses only Node.js built-in modules.
COPY package.json ./
COPY server ./server
COPY public ./public
COPY data ./data

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server/index.js"]
