# Torrent application

## Startup

To start the app use the following command (from repo root): `node examples/torrent PORT`. Once the node is app, use one of the following commands:

#### connect IP:PORT

This will connect your node to any other node, running on the following IP and PORT. You can always connect to `167.172.62.225:30162`, this is where my node of torrent network is up.

#### search FILENAME

This will look up for files all over the network. The output will look like the following:

```
 readme.md 1.72KB 75bc3ba63bf0fe60bac941e5dfa947ade1e10b07efe14f62fcc586c4578fc143
```

Note the filehash (`75bc...`). You need this for the next command.

#### download FILEHASH

This will download the file to your local `.downloads` folder. Next time indexFile is called (every minute) it will include all downloaded files into index and make you a seed for these files.
