XBE_TITLE = Multiplex
GEN_XISO = $(XBE_TITLE).iso
SRCS = $(CURDIR)/main.c \
	$(CURDIR)/gateway_auth.c \
	$(CURDIR)/gateway_catalog.c \
	$(CURDIR)/http.c \
	$(CURDIR)/storage.c \
	$(REPO_ROOT)/packages/console-core/src/auth_record.c \
	$(REPO_ROOT)/packages/console-core/src/http_response.c
NXDK_DIR ?= $(CURDIR)/.nxdk
NXDK_SDL = y
NXDK_NET = y
LDFLAGS += -stack:1048576

REPO_ROOT = $(abspath $(CURDIR)/../..)
UI_ROOT = $(REPO_ROOT)/packages/console-ui
UI_LIBRARY = $(UI_ROOT)/zig-out/lib/libmultiplex-console-ui.a

include $(NXDK_DIR)/Makefile

$(CURDIR)/main.obj: CFLAGS += -std=c11 -Wall -Wextra -Werror \
	-I$(UI_ROOT)/include \
	-I$(REPO_ROOT)/packages/console-core/include \
	-I$(CURDIR)

$(CURDIR)/storage.obj: CFLAGS += -std=c11 -Wall -Wextra -Werror \
	-I$(REPO_ROOT)/packages/console-core/include \
	-I$(CURDIR)

$(CURDIR)/gateway_auth.obj $(CURDIR)/gateway_catalog.obj \
$(CURDIR)/http.obj: CFLAGS += \
	-std=c11 -Wall -Wextra -Werror \
	-I$(REPO_ROOT)/packages/console-core/include \
	-I$(CURDIR)

$(REPO_ROOT)/packages/console-core/src/auth_record.obj: CFLAGS += \
	-std=c11 -Wall -Wextra -Werror \
	-I$(REPO_ROOT)/packages/console-core/include

$(REPO_ROOT)/packages/console-core/src/http_response.obj: CFLAGS += \
	-std=c11 -Wall -Wextra -Werror \
	-I$(REPO_ROOT)/packages/console-core/include

main.exe: $(UI_LIBRARY)
