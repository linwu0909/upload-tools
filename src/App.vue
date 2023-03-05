<template>
  <div>
    <div class="button-group">
      <input type="file" :disabled="status !== Status.wait" @change="handleFileChange" />
      <el-button @click="handleUpload" :disabled="uploadDisabled">upload</el-button>
      <!--根据status判断是中止还是复原-->
      <el-button @click="handleResume" v-if="status === Status.pause">resume</el-button>
      <el-button v-else :disabled="status !== Status.uploading || !container.hash" @click="handlePause">pause</el-button>
    </div>
    <div class="process">
      <!-- <div>calculate chunk hash</div>
      <el-progress :percentage="hashPercentage"></el-progress> -->
      <div>upload percentage</div>
      <el-progress :percentage="fakeUploadPercentage"></el-progress>
    </div>
    <div class="data-table">
      <el-table :data="data">
        <el-table-column prop="hash" label="chunk hash" align="center"></el-table-column>
        <el-table-column label="size(KB)" align="center" width="120">
          <template v-slot="{ row }">
            {{ row.size | transformByte }}
          </template>
        </el-table-column>
        <el-table-column label="percentage" align="center">
          <template v-slot="{ row }">
            <el-progress :percentage="row.percentage" color="#909399"></el-progress>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script>
// 切片大小1M
const SIZE = 1024 * 1024;
// 上传状态
const Status = {
  wait: "wait",
  pause: "pause",
  uploading: "uploading"
};
export default {
  name: "app",
  filters: {
    transformByte(val) {
      return Number((val / 1024).toFixed(0));
    }
  },
  data() {
    return {
      Status,
      container: {
        file: null,
        hash: "",
        worker: null
      },
      // 用来展示文件hash的计算进度
      // hashPercentage: 0,
      data: [],
      requestList: [],
      status: Status.wait,
      // 当暂停时会取消 xhr 导致进度条后退
      // 为了避免这种情况，需要定义一个假的进度条
      fakeUploadPercentage: 0
    }
  },
  computed: {
    // 无文件，上传中或者中止禁用上传按钮
    uploadDisabled() {
      return (
        !this.container.file ||
        [Status.pause, Status.uploading].includes(this.status)
      );
    },
    // 
    uploadPercentage() {
      if (!this.container.file || !this.data.length) return 0;
      const loaded = this.data
        .map(item => item.size * item.percentage)
        .reduce((acc, cur) => acc + cur);
      return parseInt((loaded / this.container.file.size).toFixed(2));
    }
  },
  watch: {
    uploadPercentage(now) {
      if (now > this.fakeUploadPercentage) {
        this.fakeUploadPercentage = now;
      }
    }
  },
  methods: {
    handlePause() {
      this.status = Status.pause;
      this.resetData();
    },
    // 重置数据会清空webWorker 通过xhr的abort中止请求
    resetData() {
      this.requestList.forEach(xhr => xhr?.abort());
      this.requestList = [];
      if (this.container.worker) {
        this.container.worker.onmessage = null;
      }
    },
    // 复原按钮会发送请求去验证目前上传进度 验证后继续上传
    async handleResume() {
      this.status = Status.uploading;
      const { uploadedList } = await this.verifyUpload(
        this.container.file.name,
        this.container.hash
      );
      await this.uploadChunks(uploadedList);
    },
    request({
      url,
      method = "post",
      data,
      headers = {},
      onProgress = e => e,
      requestList
    }) {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = onProgress;
        xhr.open(method, url);
        Object.keys(headers).forEach(key =>
          xhr.setRequestHeader(key, headers[key])
        );
        xhr.send(data);
        xhr.onload = e => {
          // 将请求成功的 xhr 从列表中删除
          if (requestList) {
            const xhrIndex = requestList.findIndex(item => item === xhr);
            requestList.splice(xhrIndex, 1);
          }
          resolve({
            data: e.target.response
          });
        };
        // 把请求全部存放到一个数组中
        requestList?.push(xhr);
      });
    },
    // 生成文件切片
    createFileChunk(file, size = SIZE) {
      const fileChunkList = [];
      let cur = 0;
      while (cur < file.size) {
        fileChunkList.push({ file: file.slice(cur, cur + size) });
        cur += size;
      }
      return fileChunkList;
    },
    // 生成文件hash
    calculateHash(fileChunkList) {
      return new Promise(resolve => {
        this.container.worker = new Worker("/hash.js");
        this.container.worker.postMessage({ fileChunkList });
        this.container.worker.onmessage = e => {
          const { percentage, hash } = e.data;
          // this.hashPercentage = percentage;
          if (hash) {
            resolve(hash);
          }
        };
      });
    },
    handleFileChange(e) {
      const [file] = e.target.files;
      if (!file) return;
      this.resetData();
      Object.assign(this.$data, this.$options.data());
      this.container.file = file;
    },
    async handleUpload() {
      if (!this.container.file) return;
      this.status = Status.uploading;
      const fileChunkList = this.createFileChunk(this.container.file);
      this.container.hash = await this.calculateHash(fileChunkList);
      const { shouldUpload, uploadedList } = await this.verifyUpload(
        this.container.file.name,
        this.container.hash
      );
      if (!shouldUpload) {
        this.$message.success("skip upload：file upload success");
        this.status = Status.wait;
        return;
      }
      this.data = fileChunkList.map(({ file }, index) => ({
        fileHash: this.container.hash,
        index,
        hash: this.container.hash + "-" + index,
        chunk: file,
        size: file.size,
        percentage: uploadedList.includes(index) ? 100 : 0
      }));
      await this.uploadChunks(uploadedList);
    },
    async uploadChunks(uploadedList = []) {
      const requestList = this.data
        .filter(({ hash }) => !uploadedList.includes(hash))
        .map(({ chunk, hash, index }) => {
          const formData = new FormData();
          formData.append("chunk", chunk);
          formData.append("hash", hash);
          formData.append("filename", this.container.file.name);
          formData.append("fileHash", this.container.hash);
          return { formData, index };
        })
        .map(({ formData, index }) =>
          this.request({
            url: "http://localhost:3000",
            data: formData,
            onProgress: this.createProgressHandler(this.data[index]),
            requestList: this.requestList
          })
        );
      await Promise.all(requestList);
      // 之前上传的切片数量 + 本次上传的切片数量 = 所有切片数量时合并切片
      // console.log(uploadedList.length + requestList.length)
      if (uploadedList.length + requestList.length === this.data.length) {
        await this.mergeRequest();
      }
    },
    // 通知服务端合并
    async mergeRequest() {
      await this.request({
        url: "http://localhost:3000/merge",
        headers: {
          "content-type": "application/json"
        },
        data: JSON.stringify({
          size: SIZE,
          fileHash: this.container.hash,
          filename: this.container.file.name
        })
      });
      this.$message.success("upload success");
      this.status = Status.wait;
    },
    // 根据文件hash验证是否被上传过
    async verifyUpload(filename, fileHash) {
      const { data } = await this.request({
        url: "http://localhost:3000/verify",
        headers: {
          "content-type": "application/json"
        },
        data: JSON.stringify({
          filename,
          fileHash
        })
      });
      return JSON.parse(data);
    },
    // 用闭包保存每个chunk的进度数据
    createProgressHandler(item) {
      return e => {
        item.percentage = parseInt(String((e.loaded / e.total) * 100));
      };
    }
  }
}
</script>

<style></style>