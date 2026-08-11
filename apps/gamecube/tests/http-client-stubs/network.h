#ifndef MULTIPLEX_TEST_NETWORK_H
#define MULTIPLEX_TEST_NETWORK_H

#include <arpa/inet.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <stdbool.h>
#include <sys/select.h>
#include <sys/socket.h>

#define sin_len sin_zero[0]

int if_config(char *local_ip, char *netmask, char *gateway, bool use_dhcp);
int net_close(int socket);
int net_connect(int socket, const struct sockaddr *address,
                socklen_t address_size);
int net_fcntl(int socket, int command, int flags);
int net_getsockopt(int socket, int level, int option, void *value,
                   socklen_t *size);
int net_recv(int socket, void *destination, size_t size, int flags);
int net_select(int descriptor_count, fd_set *readable, fd_set *writable,
               fd_set *exceptions, struct timeval *timeout);
int net_setsockopt(int socket, int level, int option, const void *value,
                   socklen_t size);
int net_socket(int domain, int type, int protocol);
int net_write(int socket, const void *bytes, size_t size);

#endif
