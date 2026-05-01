# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *


class MinimalProbe(gl.Contract):
    value: str

    def __init__(self, value: str):
        self.value = value

    @gl.public.view
    def get_value(self) -> str:
        return self.value
