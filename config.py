#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import json

CONFIG_FILE = os.path.expanduser("~/.nasuploader.json")

class AppConfig:
    def __init__(self):
        self.source_dir = ""
        self.target_dir = ""
        self.overwrite_duplicates = False
        
    @staticmethod
    def load_config():
        """从配置文件加载配置"""
        config = AppConfig()
        
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    config.source_dir = data.get('source_dir', '')
                    config.target_dir = data.get('target_dir', '')
                    config.overwrite_duplicates = data.get('overwrite_duplicates', False)
            except Exception as e:
                print(f"加载配置失败: {e}")
        
        return config
    
    def save_config(self):
        """保存配置到文件"""
        data = {
            'source_dir': self.source_dir,
            'target_dir': self.target_dir,
            'overwrite_duplicates': self.overwrite_duplicates
        }
        
        try:
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"保存配置失败: {e}") 