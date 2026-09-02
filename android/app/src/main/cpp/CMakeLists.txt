# CMakeLists.txt for MYnestAI Android – JNI bridge to embedded libnode.so
#
# This does NOT compile Node.js itself. It builds a small JNI bridge library
# (libnative-node.so) that links against the prebuilt libnode.so.
#
# Prebuilt libnode.so source: gmaclennan/nodejs-mobile (Node.js 24.18.0)
# https://github.com/gmaclennan/nodejs-mobile/releases/tag/v24.18.0-0
#
# The prebuilt library and headers must be placed at:
#   android/app/src/main/jniLibs/arm64-v8a/libnode.so
#   android/app/src/main/node/include/node/node.h
#
# Use: android/scripts/prepare-node-android.mjs to download and place them.

cmake_minimum_required(VERSION 3.22)
project(native-node LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Android log library
find_library(log-lib log)

# ─── Node headers ───────────────────────────────────────────────────────────
# The prepare-node-android.mjs script places matching headers (node.h, uv/*,
# cppgc/*, v8-*.h) into .../node/include/node/. Point the include path directly
# at that directory so `#include <node.h>` / `#include <uv.h>` resolve.
set(NODE_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../node/include/node")

# Verify node.h exists at configure time
if(NOT EXISTS "${NODE_INCLUDE_DIR}/node.h")
    message(FATAL_ERROR
        "Node headers not found at ${NODE_INCLUDE_DIR}/node.h\n"
        "Run: npm run android:node:prepare\n"
        "See android/README.md for details.")
endif()

# ─── Prebuilt libnode.so (Android ARM64) ────────────────────────────────────
add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES
    IMPORTED_LOCATION "${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libnode.so"
)

# Verify the prebuilt .so exists at configure time
if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libnode.so")
    message(FATAL_ERROR
        "libnode.so not found at ${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libnode.so\n"
        "Run: npm run android:node:prepare\n"
        "See android/README.md for details.")
endif()

# ─── JNI bridge library ─────────────────────────────────────────────────────
add_library(native-node SHARED
    native-node.cpp
)

target_include_directories(native-node PRIVATE
    ${NODE_INCLUDE_DIR}
)

target_link_libraries(native-node
    node
    ${log-lib}
)
