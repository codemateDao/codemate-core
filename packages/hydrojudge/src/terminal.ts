import log from './log';
import client from './sandbox/client';

export = async function terminal() {
    const version = await client.version();
    if (!version.stream) {
        log.error('no stream support, please upgrade hydro-sandbox to v1.8.1+');
        return;
    }
    if (!process.stdin.isTTY) {
        log.error('interactive terminal requires available tty');
        return;
    }
    process.stdin.setRawMode(true);
    log.info('Starting /bin/bash, double press Ctrl+C to kill all child processes.');
    const stream = client.stream({
        cmd: [
            {
                args: ['/bin/bash'],
                env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/tmp', `TERM=${process.env['TERM']}`],
                files: [{ streamIn: true }, { streamOut: true }, { streamOut: true }],
                cpuLimit: 20 * 1e9,
                clockLimit: 30 * 60 * 1e9,
                memoryLimit: 256 << 20,
                procLimit: 50,
                tty: true,
            },
        ],
    });
    stream.on('output', (output) => {
        process.stdout.write(output.content);
    });
    stream.on('open', async () => {
        let stop = false;
        process.stdin.on('data', (buf) => {
            if (buf.length === 1 && buf[0] === 3) {
                if (stop) stream.cancel();
                stop = true;
            } else stop = false;
            stream.input({ content: buf });
        });
        const resize = () => {
            stream.resize({
                rows: process.stdout.rows,
                cols: process.stdout.columns,
            });
        };
        process.stdout.on('resize', resize);
        resize();
    });
    stream.on('end', (result) => {
        process.stdin.setRawMode(false);
        log.info(result);
        process.exit(0);
    });
    stream.on('close', (e) => {
        process.stdin.setRawMode(false);
        log.info('close', e.code);
        process.exit(0);
    });
};
