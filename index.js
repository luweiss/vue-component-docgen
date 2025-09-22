#!/usr/bin/env node

import { parse } from 'vue-docgen-api'
import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'

const configFile = path.resolve('component.doc.json');

/**
 * 默认配置
 * @type {{componentsDir: string, outDir: string, docName: string, docType: string, customContent: {md: string, html: string}, docDescription: string}}
 */
const config = {
    outDir: 'dist/component-doc',
    componentsDir: 'src/components',
    docName: 'Vue Component API Documentation',
    docType: 'html', // 文档类型配置，默认html
    // 新增文档描述配置
    docDescription: '',
    // 默认customContent设置为空字符串
    customContent: {
        md: '',
        html: ''
    }
};

/**
 * 加载配置文件：
 * 如果存在文件component.doc.json
 * 则从component.doc.json加载自定义配置，并覆盖掉默认配置
 * 否则直接返回
 */
function loadConfig() {
    try {
        if (fs.existsSync(configFile)) {
            const customConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
            Object.assign(config, customConfig);

            // 合并自定义内容配置（避免完全覆盖默认配置）
            if (customConfig.customContent) {
                config.customContent = {
                    ...config.customContent,
                    ...customConfig.customContent
                };
            }

            // 验证docType配置，只允许html和md
            if (!['html', 'md'].includes(config.docType)) {
                console.warn(`无效的docType配置: ${config.docType}，将使用默认值html`);
                config.docType = 'html';
            }
        }
    } catch (error) {
        console.error('加载配置文件失败:', error.message);
    }
}

/**
 * 读取自定义内容文件
 * @returns {Promise<string>} 自定义内容字符串，读取失败则返回空字符串
 */
async function readCustomContent() {
    try {
        // 根据文档类型获取对应的自定义内容文件路径
        const contentPath = config.customContent[config.docType];
        if (!contentPath) {
            return '';
        }

        const fullPath = path.resolve(contentPath);
        if (await fsPromises.access(fullPath).then(() => true).catch(() => false)) {
            return await fsPromises.readFile(fullPath, 'utf8');
        }
        console.log(`自定义内容文件不存在: ${fullPath}`);
        return '';
    } catch (error) {
        console.error('读取自定义内容失败:', error.message);
        return '';
    }
}

/**
 * 递归查找目录下所有vue文件
 * @param {string} dir 目录路径
 * @returns {Promise<string[]>} vue文件路径列表
 */
async function findVueFiles(dir) {
    let results = [];
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.resolve(dir, entry.name);
        if (entry.isDirectory()) {
            results = [...results, ...(await findVueFiles(fullPath))];
        } else if (entry.isFile() && path.extname(entry.name) === '.vue') {
            results.push(fullPath);
        }
    }
    return results;
}

/**
 * 确保目录存在，不存在则创建
 * @param {string} dir 目录路径
 */
async function ensureDir(dir) {
    try {
        await fsPromises.access(dir);
    } catch {
        await fsPromises.mkdir(dir, { recursive: true });
    }
}

/**
 * 获取组件API文档数据
 * @param {string} filePath 文件路径
 * @returns {Promise<Object>} 组件文档数据
 */
async function getComponentDoc(filePath) {
    try {
        return await parse(filePath);
    } catch (error) {
        console.error(`解析组件${filePath}失败:`, error.message);
        return null;
    }
}

/**
 * 格式化类型显示，处理union类型
 * @param {Object} type 类型对象
 * @param {boolean} isMarkdown 是否为Markdown格式
 * @returns {string} 格式化后的类型字符串
 */
function formatType(type, isMarkdown) {
    if (type.name === 'union' && type.elements && type.elements.length) {
        // 递归处理union类型中的每个元素
        const elements = type.elements.map(element => formatType(element, isMarkdown));
        // 对于Markdown格式，使用反斜杠转义竖线
        return isMarkdown ? elements.join(' \\| ') : elements.join(' | ');
    }
    return type.name || '';
}

/**
 * 获取expose项的类型信息
 * @param {Object} exposeItem expose项
 * @returns {string} 类型信息
 */
function getExposeType(exposeItem) {
    if (!exposeItem.tags || exposeItem.tags.length === 0) {
        return '-';
    }
    const typeTag = exposeItem.tags.find(tag => tag.title === 'type');
    return typeTag ? typeTag.description : '-';
}

/**
 * 转义HTML特殊字符
 * @param {string} str 要转义的字符串
 * @returns {string} 转义后的字符串
 */
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * 格式化事件参数 - 直接处理type.names数组
 * @param {Array} properties 事件参数数组
 * @param {boolean} isMarkdown 是否为Markdown格式
 * @returns {string} 格式化后的参数字符串
 */
function formatEventParams(properties, isMarkdown) {
    if (!properties || properties.length === 0) {
        return '-';
    }

    return properties.map(prop => {
        // 直接处理事件参数特有的type.names格式
        let type = '-';
        if (prop.type && prop.type.names && prop.type.names.length) {
            // 对Markdown格式转义竖线
            type = isMarkdown
                ? prop.type.names.join(' \\| ')
                : prop.type.names.join(' | ');
        }

        const typeDisplay = isMarkdown ? `\`${type}\`` : `<code>${type}</code>`;
        const desc = prop.description ? ` - ${prop.description}` : '';
        return `${prop.name}: ${typeDisplay}${desc}`;
    }).join(isMarkdown ? '<br>' : ', ');
}

/**
 * 直接生成组件的Markdown内容
 * @param {Object} docData 组件文档数据
 * @returns {string} Markdown格式的文档内容
 */
function generateComponentMarkdown(docData) {
    let mdContent = `# ${docData.displayName}\n\n`;

    // 添加组件描述到标题下方
    if (docData.description) {
        mdContent += `## 组件描述\n${docData.description}\n\n`;
    }

    // 添加组件示例
    if (docData.tags && docData.tags.examples && docData.tags.examples.length > 0) {
        mdContent += '## 组件示例\n\n';
        docData.tags.examples.forEach((example, index) => {
            // 示例标题，默认为"示例 X"
            const title = example.title || `示例 ${index + 1}`;
            mdContent += `### ${title}\n\n`;
            // 代码块展示示例内容
            mdContent += '```html\n';
            mdContent += example.content || '';
            mdContent += '\n```\n\n';
        });
    }

    // 添加Props部分
    if (docData.props && Object.keys(docData.props).length > 0) {
        mdContent += '## Props\n\n';
        mdContent += '| 名称 | 类型 | 默认值 | 描述 |\n';
        mdContent += '|------|------|--------|------|\n';

        Object.values(docData.props).forEach(prop => {
            // 对于Markdown格式，使用转义竖线处理联合类型
            const formattedType = formatType(prop.type, true);
            // 确保用反引号包裹类型
            const typeDisplay = `\`${formattedType}\``;

            // 处理默认值中的特殊字符
            const defaultValue = prop.defaultValue
                ? `\`${prop.defaultValue.value.replace(/`/g, '\\`')}\``
                : '-';

            mdContent += `| ${prop.name} | ${typeDisplay} | ${defaultValue} | ${prop.description || '-'} |\n`;
        });
        mdContent += '\n';
    }

    // 添加Expose部分
    if (docData.expose && docData.expose.length > 0) {
        mdContent += '## Expose (暴露的方法和属性)\n\n';
        mdContent += '| 名称 | 类型 | 描述 |\n';
        mdContent += '|------|------|------|\n';

        docData.expose.forEach(item => {
            const type = getExposeType(item);
            const typeDisplay = type ? `\`${type}\`` : '-';
            mdContent += `| ${item.name} | ${typeDisplay} | ${item.description || '-'} |\n`;
        });
        mdContent += '\n';
    }

    // 添加Events部分，只提取name、properties和description
    if (docData.events && docData.events.length > 0) {
        mdContent += '## Events\n\n';
        mdContent += '| 名称 | 参数 | 描述 |\n';
        mdContent += '|------|------|------|\n';

        docData.events.forEach(event => {
            // 只处理需要的三个属性
            const params = formatEventParams(event.properties, true);
            mdContent += `| ${event.name || '-'} | ${params} | ${event.description || '-'} |\n`;
        });
        mdContent += '\n';
    }

    // 添加Slots部分
    if (docData.slots && Object.keys(docData.slots).length > 0) {
        mdContent += '## Slots\n\n';
        mdContent += '| 名称 | 描述 |\n';
        mdContent += '|------|------|\n';

        Object.values(docData.slots).forEach(slot => {
            mdContent += `| ${slot.name} | ${slot.description || '-'} |\n`;
        });
        mdContent += '\n';
    }

    return mdContent;
}

/**
 * 直接生成组件的HTML内容
 * @param {Object} docData 组件文档数据
 * @param {string} docName 文档名称
 * @param {string} componentName 组件名称
 * @returns {string} HTML格式的文档内容
 */
function generateComponentHtml(docData, docName, componentName) {
    let htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${componentName} - ${docName}</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
        h2 { color: #3498db; margin-top: 30px; }
        h3 { color: #2c3e50; margin-top: 20px; }
        .description { font-size: 1.1em; line-height: 1.6; margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-left: 4px solid #3498db; }
        .example-container { margin: 20px 0; }
        .example-title { font-weight: bold; margin-bottom: 10px; }
        .code-block { font-family: monospace; background-color: #f8f9fa; padding: 15px; border-radius: 4px; overflow-x: auto; font-size: 0.9em; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        td, th { padding: 12px 8px; text-align: left; border: 1px solid #ddd; }
        th { background-color: #f2f2f2; font-weight: bold; }
        tr:nth-child(even) { background-color: #f9f9f9; }
        .back-link { margin-bottom: 20px; display: inline-block; }
        code { background-color: #f0f0f0; padding: 2px 4px; border-radius: 3px; }
        .param-item { margin-bottom: 4px; }
        .param-item:last-child { margin-bottom: 0; }
    </style>
</head>
<body>
    <div class="back-link"><a href="index.html">← 返回组件列表</a></div>
    <h1>${docData.displayName}</h1>`;

    // 添加组件描述到标题下方，并设置样式
    if (docData.description) {
        htmlContent += `<div class="description">${docData.description}</div>`;
    }

    // 添加组件示例
    if (docData.tags && docData.tags.examples && docData.tags.examples.length > 0) {
        htmlContent += `<h2>组件示例</h2>`;
        docData.tags.examples.forEach((example, index) => {
            const title = example.title || `示例 ${index + 1}`;
            htmlContent += `
            <div class="example-container">
                <h3 class="example-title">${title}</h3>
                <pre class="code-block"><code>${escapeHtml(example.content || '')}</code></pre>
            </div>`;
        });
    }

    // 添加Props部分
    if (docData.props && Object.keys(docData.props).length > 0) {
        htmlContent += `
        <h2>Props</h2>
        <table>
            <tr>
                <th>名称</th>
                <th>类型</th>
                <th>默认值</th>
                <th>描述</th>
            </tr>`;

        Object.values(docData.props).forEach(prop => {
            // HTML格式不需要特殊处理竖线
            const formattedType = formatType(prop.type, false);
            htmlContent += `
            <tr>
                <td>${prop.name}</td>
                <td><code>${formattedType}</code></td>
                <td>${prop.defaultValue ? `<code>${prop.defaultValue.value}</code>` : '-'}</td>
                <td>${prop.description || '-'}</td>
            </tr>`;
        });

        htmlContent += `</table>`;
    }

    // 添加Expose部分
    if (docData.expose && docData.expose.length > 0) {
        htmlContent += `
        <h2>Expose (暴露的方法和属性)</h2>
        <table>
            <tr>
                <th>名称</th>
                <th>类型</th>
                <th>描述</th>
            </tr>`;

        docData.expose.forEach(item => {
            const type = getExposeType(item);
            htmlContent += `
            <tr>
                <td>${item.name}</td>
                <td>${type ? `<code>${type}</code>` : '-'}</td>
                <td>${item.description || '-'}</td>
            </tr>`;
        });

        htmlContent += `</table>`;
    }

    // 添加Events部分，只提取name、properties和description
    if (docData.events && docData.events.length > 0) {
        htmlContent += `
        <h2>Events</h2>
        <table>
            <tr>
                <th>名称</th>
                <th>参数</th>
                <th>描述</th>
            </tr>`;

        docData.events.forEach(event => {
            // 只处理需要的三个属性
            const params = formatEventParams(event.properties, false);
            htmlContent += `
            <tr>
                <td>${event.name || '-'}</td>
                <td>${params}</td>
                <td>${event.description || '-'}</td>
            </tr>`;
        });

        htmlContent += `</table>`;
    }

    // 添加Slots部分
    if (docData.slots && Object.keys(docData.slots).length > 0) {
        htmlContent += `
        <h2>Slots</h2>
        <table>
            <tr>
                <th>名称</th>
                <th>描述</th>
            </tr>`;

        Object.values(docData.slots).forEach(slot => {
            htmlContent += `
            <tr>
                <td>${slot.name}</td>
                <td>${slot.description || '-'}</td>
            </tr>`;
        });

        htmlContent += `</table>`;
    }

    htmlContent += `
</body>
</html>`;

    return htmlContent;
}

(function () {
    console.log('vue component api doc gen running...');

    // 立即执行函数改为异步执行
    (async () => {
        // 1.加载配置文件到config
        loadConfig();
        console.log('使用配置:', config);

        // 确保输出目录存在
        await ensureDir(config.outDir);

        // 2.递归查找componentsDir所有vue文件
        const componentsDir = path.resolve(config.componentsDir);
        console.log(`开始查找${componentsDir}下的vue文件...`);
        const vueFiles = await findVueFiles(componentsDir);

        if (vueFiles.length === 0) {
            console.log('未找到任何vue组件文件');
            return;
        }
        console.log(`找到${vueFiles.length}个vue组件文件`);

        const components = []; // 存储组件名和描述

        // 3.处理每个组件文件
        for (const file of vueFiles) {
            // 3.1 获取组件api参数
            const docData = await getComponentDoc(file);
            if (!docData || !docData.displayName) {
                console.log(`跳过无效组件文件: ${file}`);
                continue;
            }

            const componentName = docData.displayName;
            // 存储组件名称和描述
            components.push({
                name: componentName,
                description: docData.description || ''
            });

            let outputFile, content;

            if (config.docType === 'md') {
                // 直接生成Markdown内容
                outputFile = path.resolve(config.outDir, `${componentName}.md`);
                content = generateComponentMarkdown(docData);
            } else {
                // 直接生成HTML内容，不经过Markdown转换
                outputFile = path.resolve(config.outDir, `${componentName}.html`);
                content = generateComponentHtml(docData, config.docName, componentName);
            }

            await fsPromises.writeFile(outputFile, content, 'utf8');
            console.log(`已生成组件文档: ${outputFile}`);
        }

        // 读取自定义内容
        const customContent = await readCustomContent();

        if (config.docType === 'md') {
            // 生成Markdown索引文件，包含组件描述和自定义内容
            let indexMdContent = `# ${config.docName}\n\n`;

            // 添加文档描述（如果存在）
            if (config.docDescription) {
                indexMdContent += `${config.docDescription}\n\n`;
            }

            // 添加自定义内容（如果存在）
            if (customContent) {
                indexMdContent += `${customContent}\n\n`;
            }

            indexMdContent += '## 组件列表\n\n';

            components.forEach(component => {
                indexMdContent += `- [${component.name}](${component.name}.md)\n`;
                // 添加组件描述，如果存在的话
                if (component.description) {
                    indexMdContent += `  ${component.description}\n\n`;
                } else {
                    indexMdContent += '\n';
                }
            });

            const indexMdPath = path.resolve(config.outDir, 'index.md');
            await fsPromises.writeFile(indexMdPath, indexMdContent, 'utf8');
            console.log(`已生成索引文件: ${indexMdPath}`);
        } else {
            // 生成HTML索引文件，包含所有组件的链接、描述和自定义内容
            let componentsList = components.map(component => {
                let item = `<li class="component-item">`;
                item += `<a href="${component.name}.html" class="component-link">${component.name}</a>`;
                // 添加组件描述，如果存在的话
                if (component.description) {
                    item += `<p class="component-desc">${component.description}</p>`;
                }
                item += `</li>`;
                return item;
            }).join('\n');

            // 文档描述部分（如果存在）
            const docDescriptionSection = config.docDescription
                ? `<p class="doc-description">${config.docDescription}</p>`
                : '';

            // 自定义内容直接插入，不添加外层div
            const customContentSection = customContent ? customContent : '';

            const indexHtmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${config.docName}</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { color: #2c3e50; }
        h2 { color: #3498db; }
        .components-list { list-style: none; padding: 0; }
        .component-item { margin: 20px 0; padding: 15px; border-radius: 4px; background-color: #f9f9f9; }
        .component-link { color: #3498db; text-decoration: none; font-size: 1.2em; font-weight: bold; }
        .component-link:hover { text-decoration: underline; }
        .component-desc { margin: 8px 0 0 0; color: #555; line-height: 1.5; }
        .doc-description { font-size: 1.1em; line-height: 1.6; color: #333; margin: 10px 0 20px 0; }
    </style>
</head>
<body>
    <h1>${config.docName}</h1>
    
    ${docDescriptionSection}
    
    ${customContentSection}
    
    <h2>组件列表</h2>
    <ul class="components-list">
        ${componentsList}
    </ul>
</body>
</html>`;

            const indexHtmlPath = path.resolve(config.outDir, 'index.html');
            await fsPromises.writeFile(indexHtmlPath, indexHtmlContent, 'utf8');
            console.log(`已生成HTML索引文件: ${indexHtmlPath}`);
        }

        console.log('文档生成完成!');
    })();
})()
