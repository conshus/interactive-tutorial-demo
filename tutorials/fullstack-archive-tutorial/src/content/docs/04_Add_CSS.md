---
title: Add CSS
description: An introduction to the onboarding tutorial
---

# Starter Tutorial

This is a paragraph about what the tutorial contains.

Here is some code to add to /project/public/css/app.css:

```css
body, html {
    background-color: gray;
    height: 100%;
}
#videos {
    position: relative;
    width: 100%;
    height: 100%;
    margin-left: auto;
    margin-right: auto;
}
#subscriber {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    z-index: 10;
}
#publisher {
    position: absolute;
    width: 360px;
    height: 240px;
    bottom: 30px;
    left: 10px;
    z-index: 100;
    border: 3px solid white;
    border-radius: 3px;
}
#buttonHolder {
    position: absolute;
    width: 70%;
    margin-left: auto;
    margin-right: auto;
    bottom: 2px;
    left: 20px;
    z-index: 200;
}
#archiveLink > a {
    padding: 5px;
    background-color: white;
}
```
