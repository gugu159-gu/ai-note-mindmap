package com.ainotes.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册本机离线 OCR 插件（Google ML Kit 中文文字识别）
        registerPlugin(MlkitOcrPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
