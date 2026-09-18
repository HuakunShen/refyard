# The Refyard SSH fixture server: a real sshd, a real git, a POSIX shell, and nothing else.
#
# This image exists to answer one question honestly: can the machine's own OpenSSH run the
# reads against a remote POSIX host with nothing installed on that host? So the runtime
# package set is deliberately tiny — OpenSSH and Git from Alpine — and there is no
# Refyard artifact, no Node/Bun/Deno, and no language runtime of any kind inside.
#
# The host key is *not* in this image. `scripts/native-ssh-fixture.ts` generates it on the
# host and copies it in before the container's sshd starts, so the client's known_hosts is
# built from a key that was generated locally rather than from whatever answered first.
# The apk post-install script creates host keys while this image is built; they are removed
# here so the only host key the server ever presents is the fixture's own.
FROM alpine:3.20

RUN apk add --no-cache openssh git \
 && adduser -D -s /bin/ash gituser \
 # `adduser -D` leaves the account locked, and sshd refuses a locked account even when the
 # client authenticates with a key, so the password field is unlocked here. It stays
 # unusable as a credential: this image has no PAM, password authentication is off, and an
 # empty password is refused.
 && passwd -u gituser \
 && mkdir -p /run/sshd \
 && rm -f /etc/ssh/ssh_host_*_key /etc/ssh/ssh_host_*_key.pub

COPY sshd_config /etc/ssh/sshd_config

EXPOSE 22

# sshd cannot start without a host key and the key is intentionally absent from the image
# until the fixture copies it in, so the container waits for it instead of failing.
CMD ["/bin/sh", "-c", "while [ ! -s /etc/ssh/ssh_host_ed25519_key ]; do sleep 0.2; done; exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config"]
