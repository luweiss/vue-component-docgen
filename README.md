# vue-component-docgen

基于vue-docgen-api编写的生成组件html文档或markdown文档的工具。

## 安装
```shell
npm install vue-component-docgen
```

## 必要设置
在package.json的script选项中添加
```
"build:component-doc": "component-doc"
```
添加完成应该如下格式
```
{
  ... 其他配置
  "scripts": {
    ...
    "build:component-doc": "component-doc",
    ...
  }
}

```

## 运行

默认检索的组件目录是`src/components`

```shell
npm run build:component-doc
```
然后默认输出文档在`dist/component-doc`目录下

## 自定义配置
在项目根目录下创建配置文件`component.doc.json`，文件内容如下
```json
{
    "docType": "md",
    "docName": "我的组件文档",
    "componentsDir": "src/components",
    "outDir": "dist/component-doc"
}
```
根据需要调整参数，参数说明如下
```
docType: 默认'html'，可选'md'，输出html或markdown
docName: 文档标题
componentsDir: 组件目录
outDir: 文档输出目录
```