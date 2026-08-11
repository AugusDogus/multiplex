#!/usr/bin/env python3

import pathlib
import re
import sys


def require(source: str, text: str) -> int:
    location = source.find(text)
    if location < 0:
        raise ValueError(f"missing nonblocking-connect mechanism: {text}")
    return location


def function_source(source: str, signature: str) -> str:
    match = re.search(signature + r"\s*\{", source)
    if match is None:
        raise ValueError(f"missing function: {signature}")
    function_end = source.find("\n}", match.end())
    if function_end < 0:
        raise ValueError(f"truncated function: {signature}")
    return source[match.start() : function_end]


def check_source(source: str) -> None:
    connect = function_source(source, r"static err_t netconn_connect\([^;]+?\)")
    state = require(connect, "if(nonblocking) conn->state = NETCONN_CONNECT;")
    posted = require(connect, "if(apimsg_post(msg)!=ERR_OK)")
    returned = require(connect, "if(nonblocking) return ERR_OK;")
    blocked = require(connect, "MQ_Receive(conn->mbox,(mqmsg_t)&dummy,MQ_MSG_BLOCK);")
    if not state < posted < returned < blocked:
        raise ValueError("nonblocking connect does not return before MQ_MSG_BLOCK")

    input_function = function_source(
        source, r"static void apimsg_input\(struct api_msg \*msg\)"
    )
    decoded = require(input_function, "decode[msg->type](&(msg->msg));")
    released = require(input_function, "memp_free(MEMP_API_MSG,msg);")
    if decoded > released:
        raise ValueError("async connect message is freed before decode uses it")

    post_function = function_source(
        source, r"static err_t net_apimsg\(struct api_msg \*apimsg\)"
    )
    sent = require(post_function, "MQ_Send(netthread_mbox,(mqmsg_t)msg,MQ_MSG_BLOCK);")
    succeeded = require(post_function, "return ERR_OK;")
    if sent > succeeded:
        raise ValueError("net_apimsg reports success before posting the message")

    require(source, "conn->state = NETCONN_NONE;")
    require(source, "NETCONN_EVTSENDPLUS")
    require(source, "(sock->flags&O_NONBLOCK)")
    require(source, "return -EALREADY;")
    require(source, "return -EISCONN;")
    require(source, "return -EINPROGRESS;")


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} patched-network.c", file=sys.stderr)
        return 2
    path = pathlib.Path(sys.argv[1])
    try:
        check_source(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(f"{path}: {error}", file=sys.stderr)
        return 1
    print(f"libogc2 nonblocking connect mechanism verified: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
