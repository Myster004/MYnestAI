/**
 * JNI bridge between Android Java and embedded libnode.so (Node.js 24).
 *
 * Links against prebuilt libnode.so (Android ARM64) from gmaclennan/nodejs-mobile.
 * Calls node::Start(argc, argv) which blocks until Node.js exits.
 *
 * See: https://github.com/gmaclennan/nodejs-mobile
 * See: https://nodejs-mobile.github.io/
 */
#include <jni.h>
#include <fcntl.h>
#include <string>
#include <cstring>
#include <cstdlib>
#include <unistd.h>
#include <android/log.h>
#include <node.h>

#define LOG_TAG "NativeNode"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

extern "C" {

/**
 * Start Node.js with the given arguments.
 * This is a blocking call – it runs the Node.js event loop until exit.
 * Must be called from a background thread.
 *
 * @param env   JNI environment
 * @param thiz  Java NativeNode class reference
 * @param args  Java String[] – the node command-line arguments
 * @return Node.js process exit code (0 = success)
 */
JNIEXPORT jint JNICALL
Java_app_sillytavern_android_NativeNode_startNode(
    JNIEnv* env,
    jclass /* NativeNode class */,
    jobjectArray args,
    jstring cwd) {

    // Convert Java String[] to char** for node::Start()
    int argc = env->GetArrayLength(args);
    if (argc <= 0) return -1;

    // Allocate argv array: node binary name + user args + null terminator
    char** argv = new char*[argc + 2];

    // argv[0] is the program name – use "node" as convention
    argv[0] = strdup("node");

    for (int i = 0; i < argc; i++) {
        auto jstr = (jstring) env->GetObjectArrayElement(args, i);
        if (jstr == nullptr) {
            argv[i + 1] = strdup("");
        } else {
            const char* nativeStr = env->GetStringUTFChars(jstr, nullptr);
            argv[i + 1] = strdup(nativeStr);
            env->ReleaseStringUTFChars(jstr, nativeStr);
        }
        env->DeleteLocalRef(jstr);
    }
    argv[argc + 1] = nullptr;

    // Set working directory if provided (SillyTavern dir)
    std::string cwdSaved;
    if (cwd != nullptr) {
        const char* cwdStr = env->GetStringUTFChars(cwd, nullptr);
        if (cwdStr != nullptr) {
            cwdSaved = cwdStr;
            // chdir for working directory - affects Node's process.cwd()
            if (chdir(cwdStr) != 0) {
                LOGW("chdir to %s failed: %s", cwdStr, strerror(errno));
            }
            env->ReleaseStringUTFChars(cwd, cwdStr);
        }
    }

    // Redirect stdout/stderr to a log file - console.log output otherwise
    // never reaches logcat in this embedded environment.
    if (!cwdSaved.empty()) {
        std::string logPath = cwdSaved + "/../node_stdio.log";
        int logFd = open(logPath.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
        if (logFd >= 0) {
            dup2(logFd, STDOUT_FILENO);
            dup2(logFd, STDERR_FILENO);
            close(logFd);
            LOGI("Redirected stdout/stderr to %s", logPath.c_str());
        } else {
            LOGW("Failed to open node stdio log %s: %s", logPath.c_str(), strerror(errno));
        }
    }

    LOGI("Starting Node.js with %d args, cwd=%s", argc, cwd ? "(set)" : "(default)");

    // node::Start() is the embedded entry point – blocks until Node exits
    int exitCode = node::Start(argc + 1, argv);

    // Clean up
    for (int i = 0; i <= argc; i++) {
        free(argv[i]);
    }
    delete[] argv;

    __android_log_print(ANDROID_LOG_INFO, "NativeNode",
        "Node.js exited with code %d", exitCode);

    return exitCode;
}

/**
 * Check if the native Node library is loaded and functional.
 * Returns the Node.js version string, or null if unavailable.
 * Uses NODE_VERSION_STRING from node_version.h (provided by the prebuilt headers).
 */
JNIEXPORT jstring JNICALL
Java_app_sillytavern_android_NativeNode_getNodeVersion(
    JNIEnv* env,
    jclass /* NativeNode class */) {
#ifdef NODE_VERSION_STRING
    return env->NewStringUTF(NODE_VERSION_STRING);
#else
    return env->NewStringUTF("unknown");
#endif
}

}  // extern "C"
