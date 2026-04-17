### Building and running the fitness frontend

Start the frontend container by running:
`docker compose up --build`.

The Fitness Tracker frontend will be available at http://localhost:3000.

### Deploying your application to the cloud

First, build your image, e.g.: `docker build -t fitness-frontend .`.
If your cloud uses a different CPU architecture than your development
machine (e.g., you are on a Mac M1 and your cloud provider is amd64),
you'll want to build the image for that platform, e.g.:
`docker build --platform=linux/amd64 -t fitness-frontend .`.

Then, push it to your registry, e.g. `docker push myregistry.com/fitness-frontend`.

Consult Docker's [getting started](https://docs.docker.com/go/get-started-sharing/)
docs for more detail on building and pushing.

### References
* [Docker's Node.js guide](https://docs.docker.com/language/nodejs/)
