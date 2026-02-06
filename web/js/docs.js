// ==========================================
// 1. 文档配置表 (Mapping)
// ==========================================
const DOCS_CONFIG = [
    { 
        file: { zh: '1. README（总览）.md', en: '1. README(Overview).md' }, 
        title: { zh: '1. 总览', en: '1. Overview' } 
    },
    { 
        file: { zh: '2. 陆战部分.md', en: '2. Land Combat.md' }, 
        title: { zh: '2. 陆战机制', en: '2. Land Combat' } 
    },
    { 
        file: { zh: '3. 空战部分.md', en: '3. Air Combat.md' }, 
        title: { zh: '3. 空战机制', en: '3. Air Combat' } 
    },
    { 
        file: { zh: '4. 伤害结算.md', en: '4. Damage Resolution.md' }, 
        title: { zh: '4. 伤害结算流程', en: '4. Damage Resolution' } 
    },
    { 
        file: { zh: '5. 建筑、加成.md', en: '5. Buildings and Modifiers.md' }, 
        title: { zh: '5. 建筑与加成', en: '5. Buildings & Modifiers' } 
    },
    { 
        file: { zh: '6. 参考.md', en: '6. References.md' }, 
        title: { zh: '6. 参考资料', en: '6. References' } 
    },
    { 
        file: { zh: '7. Execution Order Summary.md', en: '7. Execution Order Summary (EN).md' }, 
        title: { zh: '7. 执行顺序汇总', en: '7. Execution Order' } 
    },
    { 
        file: { zh: 'ChangeLog.md', en: '../zh/ChangeLog.md' }, 
        title: { zh: '更新日志', en: 'ChangeLog' } 
    },
    { 
        file: { zh: 'LICENSE.md', en: '../zh/LICENSE.md' }, 
        title: { zh: '开源协议', en: 'License' } 
    }
];

// ==========================================
// 2. DOM 引用与初始化
// ==========================================
const docEls = {
    overlay: document.getElementById('doc-modal-overlay'),
    sidebar: document.getElementById('doc-sidebar'),
    mobileNav: document.getElementById('doc-mobile-nav'),
    viewer: document.getElementById('doc-viewer'),
    btnOpen: document.getElementById('btn-open-doc')
};

let currentDocIndex = 0;

// ==========================================
// 3. 等待所有库加载完成
// ==========================================
function waitForLibraries() {
    return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
            // 检查所有必需的库是否已加载
            const markedReady = typeof marked !== 'undefined';
            const katexReady = typeof katex !== 'undefined';
            const mermaidReady = typeof mermaid !== 'undefined';
            
            if (markedReady && katexReady && mermaidReady) {
                clearInterval(checkInterval);
                console.log('✅ All libraries loaded');
                resolve();
            }
        }, 50); // 每50ms检查一次
        
        // 超时保护（5秒后强制继续）
        setTimeout(() => {
            clearInterval(checkInterval);
            console.warn('⚠️ Library loading timeout, proceeding anyway');
            resolve();
        }, 5000);
    });
}

// ==========================================
// 4. 初始化 Marked + KaTeX 扩展
// ==========================================
function initializeMarkedWithKatex() {
    if (typeof marked === 'undefined') {
        console.error('❌ Marked not loaded');
        return false;
    }
    
    if (typeof katex === 'undefined') {
        console.error('❌ KaTeX not loaded');
        return false;
    }
    
    // 手动实现 KaTeX 渲染器（不依赖 marked-katex-extension）
    const renderer = new marked.Renderer();
    const originalCode = renderer.code.bind(renderer);
    
    // 拦截代码块，处理 math 语言标记
    renderer.code = function(code, language) {
        if (language === 'math' || language === 'latex') {
            try {
                return katex.renderToString(code, {
                    displayMode: true,
                    throwOnError: false
                });
            } catch (e) {
                console.error('KaTeX render error:', e);
                return `<pre class="katex-error">${code}</pre>`;
            }
        }
        return originalCode(code, language);
    };
    
    // 配置 Marked
    marked.setOptions({
        renderer: renderer,
        breaks: true,
        gfm: true
    });
    
    console.log('✅ Marked + KaTeX configured');
    return true;
}

// ==========================================
// 5. 处理行内和块级 LaTeX 公式
// ==========================================
function processLatexInHTML(html) {
    // 处理块级公式 $$...$$
    html = html.replace(/\$\$([\s\S]+?)\$\$/g, (match, formula) => {
        try {
            return katex.renderToString(formula.trim(), {
                displayMode: true,
                throwOnError: false
            });
        } catch (e) {
            console.error('KaTeX block error:', e);
            return match;
        }
    });
    
    // 处理行内公式 $...$（但要避免误匹配货币符号等）
    html = html.replace(/\$([^\$\n]+?)\$/g, (match, formula) => {
        // 简单启发式：如果包含常见 LaTeX 符号，则渲染
        if (/[\\{}^_]/.test(formula)) {
            try {
                return katex.renderToString(formula.trim(), {
                    displayMode: false,
                    throwOnError: false
                });
            } catch (e) {
                console.error('KaTeX inline error:', e);
                return match;
            }
        }
        return match; // 保留原始文本（可能是货币符号）
    });
    
    return html;
}

// ==========================================
// 6. 处理 Mermaid 图表
// ==========================================
async function processMermaidDiagrams(container) {
    if (typeof mermaid === 'undefined') {
        console.warn('⚠️ Mermaid not loaded, skipping diagrams');
        return;
    }
    
    // 查找所有 Mermaid 代码块
    const mermaidBlocks = container.querySelectorAll('code.language-mermaid');
    
    if (mermaidBlocks.length === 0) {
        return; // 没有图表，直接返回
    }
    
    console.log(`🔍 Found ${mermaidBlocks.length} Mermaid diagram(s)`);
    
    // 转换代码块为 mermaid div
    const mermaidDivs = [];
    mermaidBlocks.forEach((block, index) => {
        const pre = block.parentElement;
        const div = document.createElement('div');
        div.className = 'mermaid';
        div.textContent = block.textContent.trim();
        div.style.visibility = 'hidden'; // 先隐藏，渲染完再显示
        
        pre.replaceWith(div);
        mermaidDivs.push(div);
    });
    
    // 渲染所有图表
    try {
        // Mermaid v10+ 使用 run() 方法
        if (mermaid.run) {
            await mermaid.run({
                nodes: mermaidDivs,
                suppressErrors: false
            });
        } 
        // 兼容旧版本 Mermaid
        else if (mermaid.init) {
            mermaid.init(undefined, mermaidDivs);
        }
        
        // 显示渲染后的图表
        mermaidDivs.forEach(div => {
            div.style.visibility = 'visible';
        });
        
        console.log('✅ Mermaid diagrams rendered');
    } catch (e) {
        console.error('❌ Mermaid render error:', e);
        // 失败时也显示元素，避免空白
        mermaidDivs.forEach(div => {
            div.style.visibility = 'visible';
            div.style.border = '1px solid red';
            div.style.padding = '10px';
            div.innerHTML = `<pre style="color:red">Mermaid Error: ${e.message}\n\n${div.textContent}</pre>`;
        });
    }
}

// ==========================================
// 7. 主初始化函数
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('📚 Docs system initializing...');
    
    // 等待所有库加载
    await waitForLibraries();
    
    // 初始化 Mermaid（设置为手动模式）
    if (typeof mermaid !== 'undefined') {
        mermaid.initialize({ 
            startOnLoad: false, 
            theme: 'neutral',
            securityLevel: 'loose' // 允许 HTML 标签
        });
        console.log('✅ Mermaid initialized');
    }
    
    // 初始化 Marked + KaTeX
    initializeMarkedWithKatex();
    
    // 绑定事件
    if (docEls.btnOpen) {
        docEls.btnOpen.onclick = openDocModal;
    }
    
    if (docEls.mobileNav) {
        docEls.mobileNav.addEventListener('change', (e) => {
            loadDocByIndex(parseInt(e.target.value));
        });
    }
    
    docEls.overlay.addEventListener('click', (e) => {
        if (e.target === docEls.overlay) closeDocModal();
    });

    docEls.viewer.addEventListener('click', handleDocLinkClick);
    
    console.log('✅ Docs system ready');
});

// ==========================================
// 8. 语言获取修复
// ==========================================
function getCurrentLang() {
    if (window.currentLang) {
        return (window.currentLang === 'zh' || window.currentLang === 'cn') ? 'zh' : 'en';
    }
    
    const btn = document.getElementById('btn-lang');
    if (btn && btn.textContent.includes('English')) return 'zh';
    return 'en';
}

// ==========================================
// 9. 核心功能函数
// ==========================================

function openDocModal() {
    renderDocNav(); 
    docEls.overlay.classList.remove('hidden');
    loadDocByIndex(currentDocIndex);
}

function closeDocModal() {
    docEls.overlay.classList.add('hidden');
}

function renderDocNav() {
    const lang = getCurrentLang();
    let htmlSidebar = '';
    let htmlMobile = '';

    DOCS_CONFIG.forEach((doc, index) => {
        const title = doc.title[lang] || doc.title['en'];
        const activeClass = (index === currentDocIndex) ? 'active' : '';
        htmlSidebar += `<div class="doc-nav-item ${activeClass}" id="doc-nav-${index}" onclick="loadDocByIndex(${index})">${title}</div>`;
        htmlMobile += `<option value="${index}" ${index === currentDocIndex ? 'selected' : ''}>${title}</option>`;
    });

    docEls.sidebar.innerHTML = htmlSidebar;
    docEls.mobileNav.innerHTML = htmlMobile;
}

async function loadDocByIndex(index, anchor = null) {
    currentDocIndex = index;
    
    // 更新导航状态
    document.querySelectorAll('.doc-nav-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.getElementById(`doc-nav-${index}`);
    if (activeItem) activeItem.classList.add('active');
    if (docEls.mobileNav) docEls.mobileNav.value = index;

    // 显示加载状态
    docEls.viewer.innerHTML = '<div class="loading-spinner" style="text-align:center; padding:50px;"><i class="fas fa-spinner fa-spin"></i> Loading document...</div>';

    const lang = getCurrentLang();
    const config = DOCS_CONFIG[index];
    const filename = config.file[lang] || config.file['en'];
    const path = `./doc/${lang}/${filename}`;

    try {
        // 加载 Markdown 文件
        const response = await fetch(path);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const markdownText = await response.text();
        
        // Step 1: Markdown → HTML
        let html = marked.parse(markdownText);
        
        // Step 2: 处理 LaTeX 公式（在 Marked 之后）
        html = processLatexInHTML(html);
        
        // Step 3: 插入到 DOM
        docEls.viewer.innerHTML = html;
        
        // Step 4: 处理 Mermaid 图表
        await processMermaidDiagrams(docEls.viewer);
        
        // Step 5: 处理锚点跳转
        if (anchor) {
            setTimeout(() => {
                try {
                    let element = document.getElementById(anchor);
                    
                    if (!element) {
                        const headings = docEls.viewer.querySelectorAll('h1,h2,h3,h4,h5,h6');
                        for (let h of headings) {
                            if (h.id === anchor || h.textContent.trim() === decodeURIComponent(anchor)) {
                                element = h;
                                break;
                            }
                        }
                    }
                    
                    if (element) {
                        element.scrollIntoView({ behavior: 'smooth' });
                    }
                } catch(e) {
                    console.error('Anchor navigation error:', e);
                }
            }, 200); // 给 Mermaid 渲染留出时间
        } else {
            docEls.viewer.scrollTop = 0;
        }
        
        console.log('✅ Document loaded successfully');

    } catch (err) {
        console.error('Document load error:', err);
        docEls.viewer.innerHTML = `
            <div style="color:red; padding:20px; border:2px solid red; border-radius:8px;">
                <h3>❌ Failed to load document</h3>
                <p><strong>Error:</strong> ${err.message}</p>
                <p><strong>Path:</strong> ${path}</p>
                <p>Please check the console for details.</p>
            </div>
        `;
    }
}

// 链接拦截逻辑
function handleDocLinkClick(e) {
    const link = e.target.closest('a');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href) return;

    // 外部链接
    if (href.startsWith('http://') || href.startsWith('https://')) {
        e.preventDefault();
        window.open(href, '_blank');
        return;
    }

    // Markdown 文档链接
    if (href.includes('.md')) {
        e.preventDefault();
        const parts = href.split('#');
        let targetFilename = decodeURIComponent(parts[0]);
        const targetAnchor = parts[1] ? decodeURIComponent(parts[1]) : null;
        targetFilename = targetFilename.replace(/^(\.\/|\/)/, '');

        const targetIndex = findIndexByFilename(targetFilename);
        if (targetIndex !== -1) {
            loadDocByIndex(targetIndex, targetAnchor);
        } else {
            console.warn('Document not found:', targetFilename);
        }
    }
}

function findIndexByFilename(filename) {
    const lang = getCurrentLang();
    return DOCS_CONFIG.findIndex(item => {
        let configName = item.file[lang] || item.file['en'];
        if (configName && configName.split('/').pop() === filename.split('/').pop()) return true;
        let enName = item.file['en'];
        if (enName && enName.split('/').pop() === filename.split('/').pop()) return true;
        return false;
    });
}

// 全局导出
window.openDocModal = openDocModal;
window.closeDocModal = closeDocModal;
window.loadDocByIndex = loadDocByIndex;